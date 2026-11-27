import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import prisma from "../app/db.server";
import {
  normalizeCarrierPayload,
  type PricingTrace,
  type ScenarioDraft,
} from "../app/models/calculated-rates";
import {
  getScenario,
  saveScenario,
} from "../app/models/calculated-rates.server";
import { signCarrierCallback } from "../app/models/carrier-shopify.server";
import {
  evaluateStoreCart,
  getPricingStore,
} from "../app/models/checkout-pricing.server";
import { newLiveCarrierRate } from "../app/models/live-carrier";
import {
  changeUpsConnection,
  getUpsConnection,
} from "../app/models/live-carrier.server";
import { emptyPackage, emptyPacking } from "../app/models/package-pricing";
import {
  completeOnboarding,
  OperatingMode,
} from "../app/models/shop-settings.server";
import { action } from "../app/routes/carrier-rates";

const shop = `m9-${randomUUID()}.myshopify.com`;
const originalFetch = globalThis.fetch;
const originalKey = process.env.SHIPFLOW_CARRIER_KEY;
const originalSecret = process.env.SHOPIFY_API_SECRET;
process.env.SHIPFLOW_CARRIER_KEY = randomBytes(32).toString("hex");
const secret = (process.env.SHOPIFY_API_SECRET = randomUUID());
let unavailable = false;
let quoteCurrency = "USD";
const shipments: {
  ShipFrom: { Address: { PostalCode: string } };
  ShipTo: { Address: { CountryCode: string } };
  Package: {
    PackageWeight: { Weight: string };
    Dimensions: { Length: string };
  }[];
}[] = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://onlinetools.ups.com/security/v1/oauth/token") {
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      `Basic ${Buffer.from("fixture-id:fixture-secret").toString("base64")}`,
    );
    return Response.json({ access_token: "fixture-token", expires_in: "3600" });
  }
  assert.equal(url, "https://onlinetools.ups.com/api/rating/v2409/Shop");
  assert.equal(
    new Headers(init?.headers).get("authorization"),
    "Bearer fixture-token",
  );
  assert.ok(init?.signal);
  const { RateRequest } = JSON.parse(String(init?.body));
  assert.equal(RateRequest.Request.RequestOption, "Shop");
  shipments.push(RateRequest.Shipment);
  if (unavailable) return new Response("provider detail", { status: 503 });
  const international =
    RateRequest.Shipment.ShipTo.Address.CountryCode === "CA";
  return Response.json({
    RateResponse: {
      RatedShipment: [
        {
          Service: { Code: international ? "07" : "03" },
          TotalCharges: { CurrencyCode: quoteCurrency, MonetaryValue: "15.01" },
          NegotiatedRateCharges: {
            TotalCharge: {
              CurrencyCode: quoteCurrency,
              MonetaryValue: "12.5000",
            },
          },
        },
        {
          Service: { Code: international ? "08" : "01" },
          TotalCharges: { CurrencyCode: quoteCurrency, MonetaryValue: "20.00" },
        },
      ],
    },
  });
};

try {
  const store = await completeOnboarding(shop, OperatingMode.CCS_RATES);
  await prisma.store.update({
    where: { id: store.id },
    data: {
      carrierServiceId: `gid://shopify/DeliveryCarrierService/${store.id}`,
      ccsStatus: "ENABLED",
    },
  });
  const form = (values: Record<string, string>) => {
    const fields = new FormData();
    for (const [key, value] of Object.entries(values)) fields.set(key, value);
    return fields;
  };
  const sample = {
    originCountry: "US",
    originPostal: "30005",
    originProvince: "GA",
    destinationCountry: "US",
    destinationPostal: "10001",
    destinationProvince: "NY",
  };
  await changeUpsConnection(
    store.id,
    form({
      ...sample,
      intent: "carrier-connect",
      environment: "production",
      account: "ABC123",
      clientId: "fixture-id",
      clientSecret: "fixture-secret",
    }),
  );
  let connection = (await getUpsConnection(store.id))!;
  assert.deepEqual(
    connection.services.domestic.map(({ code }) => code),
    ["03", "01"],
  );
  assert.ok(!JSON.stringify(connection).includes("fixture-secret"));
  const stored = await prisma.carrierConnection.findFirstOrThrow({
    where: { storeId: store.id },
  });
  assert.ok(!stored.credentials.includes("fixture-secret"));
  await changeUpsConnection(
    store.id,
    form({
      ...sample,
      intent: "carrier-test",
      revision: connection.revision,
      destinationCountry: "CA",
      destinationProvince: "ON",
      destinationPostal: "M5V 3A8",
    }),
  );
  connection = (await getUpsConnection(store.id))!;
  assert.deepEqual(
    connection.services.international.map(({ code }) => code),
    ["07", "08"],
  );
  assert.equal(connection.services.domestic.length, 2);
  const region = await prisma.shippingRegion.create({
    data: {
      storeId: store.id,
      kind: "DOMESTIC",
      name: "Quote region",
      coverage: [
        { country: "US", provinces: [] },
        { country: "CA", provinces: [] },
      ],
    },
  });
  await prisma.catalogProduct.create({
    data: {
      storeId: store.id,
      id: 55n,
      title: "Sized item",
      tags: [],
      searchTags: "",
      productType: "",
      vendor: "",
      seenAt: new Date(),
      variants: {
        create: {
          id: 99n,
          title: "Default",
          sku: "S",
          barcode: "",
          length: 8,
          width: 5,
          height: 4,
        },
      },
    },
  });
  const id = randomUUID();
  const draft: ScenarioDraft = {
    name: "Carrier integration",
    active: true,
    conditions: [{ field: "cartQuantity", operator: "gte", value: "1" }],
    rates: [
      {
        id,
        regionId: region.id,
        name: "Internal carrier name",
        description: "",
        price: "",
        tags: "live",
        liveCarrier: {
          ...newLiveCarrierRate,
          domestic: ["03", "01"],
          selection: "lowest",
          international: ["08"],
          internationalSelection: "highest",
          fallback: {
            kind: "percent",
            name: "Backup shipping",
            description: "Fallback",
            value: "20",
          },
        },
        pricing: {
          mode: "flat",
          criteria: "cart",
          basis: "total",
          amountType: "fixed",
          handling: { kind: "fixed", value: "1.50", basis: "shipping" },
        },
      },
    ],
  };
  const scenario = await saveScenario(shop, null, null, draft, "USD");
  assert.equal(
    (await getScenario(store.id, scenario.id))?.draft.rates[0].liveCarrier
      ?.carrier,
    "ups",
  );
  const payload = {
    rate: {
      currency: "USD",
      origin: { country: "US", province: "GA", postal_code: "30005" },
      destination: {
        country: "US",
        province: "NY",
        name: "shipflow Test",
        postal_code: "10001",
      },
      items: [
        { variant_id: 99, quantity: 2, grams: 400, price: 2000 },
        { variant_id: 98, quantity: 1, grams: 100, price: 1000 },
      ],
    },
  };
  const pricing = (await getPricingStore(store.id))!;
  const signature = signCarrierCallback(store.id, secret);
  const url = new URL(
    `https://test.example/carrier-rates/${store.id}/${signature}`,
  );
  async function checkout(name: string, price: string) {
    const simulated = await evaluateStoreCart(
      pricing,
      normalizeCarrierPayload(payload)!,
      { simulation: true },
    );
    const response = await action({
      request: new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      url,
      params: { storeId: store.id, signature },
      context: {},
      pattern: "/carrier-rates/:storeId/:signature",
    } as ActionFunctionArgs);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { rates: simulated.rates });
    assert.equal(simulated.rates.length, 1);
    assert.equal(simulated.rates[0].service_name, name);
    assert.equal(simulated.rates[0].total_price, price);
    return simulated;
  }
  const live = await checkout("UPS Ground", "1400");
  assert.match(
    live.trace?.rates[0].steps?.[0].detail ?? "",
    /2 package.*1 unit/,
  );
  assert.equal(shipments.at(-1)?.ShipFrom.Address.PostalCode, "30005");
  assert.deepEqual(
    shipments.at(-1)?.Package.map((box) => box.PackageWeight.Weight),
    ["0.9", "0.9"],
  );
  payload.rate.destination = {
    ...payload.rate.destination,
    country: "CA",
    province: "ON",
    postal_code: "M5V 3A8",
  };
  await checkout("UPS Worldwide Expedited", "2150");
  payload.rate.destination = {
    ...payload.rate.destination,
    country: "US",
    province: "NY",
    postal_code: "10001",
  };
  quoteCurrency = "CAD";
  const wrongCurrency = await checkout("Backup shipping", "1150");
  assert.match(
    wrongCurrency.trace?.rates[0].steps?.[0].detail ?? "",
    /did not return a quote in USD/,
  );
  quoteCurrency = "USD";
  unavailable = true;
  const failed = await checkout("Backup shipping", "1150");
  assert.match(failed.trace?.rates[0].steps?.[0].detail ?? "", /HTTP 503/);
  const history = await prisma.carrierRequest.findFirstOrThrow({
    where: { storeId: store.id },
    orderBy: { receivedAt: "desc" },
  });
  const trace = history.trace as PricingTrace;
  assert.equal(trace.rates[0].steps?.[0].label, "Carrier fallback");
  assert.match(trace.rates[0].steps?.[0].detail ?? "", /HTTP 503/);
  await assert.rejects(
    changeUpsConnection(
      store.id,
      form({ intent: "carrier-sync", revision: connection.revision }),
    ),
    /HTTP 503/,
  );
  assert.match((await getUpsConnection(store.id))?.error ?? "", /HTTP 503/);
  unavailable = false;

  payload.rate.items.pop();
  const box = {
    ...emptyPackage,
    name: "Carton",
    limit: "2",
    length: "16",
    width: "8",
    height: "8",
    maxWeight: "2",
    emptyWeight: "0.2",
  };
  for (const method of ["attributes", "dimensions"] as const) {
    const saved = (await getScenario(store.id, scenario.id))!;
    const rate = draft.rates[0];
    draft.rates[0] = {
      ...rate,
      liveCarrier: {
        ...rate.liveCarrier!,
        packaging: method,
        packing: { ...emptyPacking, method, packages: [box] },
      },
    };
    await saveScenario(shop, scenario.id, saved.revision, draft, "USD");
    await checkout("UPS Ground", "1400");
    assert.equal(shipments.at(-1)?.Package.length, 1);
    assert.equal(shipments.at(-1)?.Package[0].PackageWeight.Weight, "2.3");
  }
  await changeUpsConnection(
    store.id,
    form({ intent: "carrier-disconnect", revision: connection.revision }),
  );
  assert.equal(await getUpsConnection(store.id), null);
  const disconnected = await checkout("Backup shipping", "950");
  assert.match(
    disconnected.trace?.rates[0].steps?.[0].detail ?? "",
    /disconnected/,
  );
  console.log(
    "M9 carrier connection, service filtering, parcel weights, and signed callback fallback passed.",
  );
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.SHIPFLOW_CARRIER_KEY;
  else process.env.SHIPFLOW_CARRIER_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = originalSecret;
  await prisma.store.deleteMany({ where: { shopDomain: shop } });
  await prisma.$disconnect();
}
