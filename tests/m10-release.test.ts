import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import prisma from "../app/db.server";
import {
  normalizeCarrierPayload,
  type ScenarioDraft,
} from "../app/models/calculated-rates";
import { saveScenario } from "../app/models/calculated-rates.server";
import { signCarrierCallback } from "../app/models/carrier-shopify.server";
import {
  defaultAppearance,
  deliveryEstimate,
  validateAppearance,
  validateShippingConfiguration,
} from "../app/models/checkout-settings";
import {
  evaluateStoreCart,
  getPricingStore,
} from "../app/models/checkout-pricing.server";
import { emptyCombinedDraft } from "../app/models/combined-rates";
import { saveCombinedRule } from "../app/models/combined-rates.server";
import { connectMaps } from "../app/models/maps-distance.server";
import { newLiveCarrierRate } from "../app/models/live-carrier";
import {
  completeOnboarding,
  OperatingMode,
  switchOperatingMode,
} from "../app/models/shop-settings.server";
import { action as callback } from "../app/routes/carrier-rates";

const friday = new Date("2026-11-27T12:00:00Z");
assert.deepEqual(
  deliveryEstimate(
    1,
    2,
    { ...defaultAppearance, format: "DD-MM-YYYY" },
    "America/New_York",
    friday,
  ),
  {
    text: "30-11-2026 – 01-12-2026",
    min: "2026-11-30 12:00:00 -0500",
    max: "2026-12-01 12:00:00 -0500",
  },
);
assert.deepEqual(
  deliveryEstimate(
    1,
    2,
    { ...defaultAppearance, precise: false, label: "working days" },
    "UTC",
    friday,
  ),
  {
    text: "1 – 2 working days",
  },
);
const invalid = new FormData();
invalid.set("format", "custom");
invalid.set("custom", "YYYY-DD");
assert.throws(() => validateAppearance(invalid), /once each/);

const shop = `m10-${randomUUID()}.myshopify.com`;
const other = `m10-${randomUUID()}.myshopify.com`;
const restore = {
  secret: process.env.SHOPIFY_API_SECRET,
  key: process.env.SHIPFLOW_CARRIER_KEY,
  fetch: globalThis.fetch,
};
const secret = (process.env.SHOPIFY_API_SECRET = randomUUID());
process.env.SHIPFLOW_CARRIER_KEY = randomBytes(32).toString("hex");
const testKey = "maps-fixture-key-no-network";
let calls = 0;
let mapsAvailable = true;
globalThis.fetch = async (url, init) => {
  assert.equal(
    String(url),
    "https://routes.googleapis.com/directions/v2:computeRoutes",
  );
  assert.equal(new Headers(init?.headers).get("X-Goog-Api-Key"), testKey);
  assert.equal(
    new Headers(init?.headers).get("X-Goog-FieldMask"),
    "routes.distanceMeters",
  );
  const route = JSON.parse(String(init?.body));
  assert.equal(route.travelMode, "DRIVE");
  calls++;
  if (!mapsAvailable)
    return new Response("intentionally unavailable", { status: 503 });
  return Response.json({ routes: [{ distanceMeters: 12000 }] });
};

try {
  const [store, second] = await Promise.all([
    completeOnboarding(shop, OperatingMode.CCS_RATES),
    completeOnboarding(other, OperatingMode.CCS_RATES),
  ]);
  const mapsCredentials = await connectMaps(store.id, testKey);
  assert.ok(!mapsCredentials.includes(testKey));
  const form = new FormData();
  for (const [name, value] of Object.entries({
    preventDoubling: "true",
    ukPostal: "true",
    manualCodes: "true",
    fallbackEnabled: "true",
    fallbackName: "Store backup",
    fallbackKind: "percent",
    fallbackValue: "10",
  }))
    form.set(name, value);
  const shippingConfiguration = validateShippingConfiguration(form, "USD");
  await prisma.store.update({
    where: { id: store.id },
    data: {
      carrierServiceId: `gid://shopify/DeliveryCarrierService/${store.id}`,
      ccsStatus: "ENABLED",
      settings: {
        update: {
          shippingConfiguration,
          mapsCredentials,
          discountedCartTotal: true,
          checkoutAppearance: {
            ...defaultAppearance,
            label: "working days",
            precise: false,
          },
        },
      },
    },
  });
  assert.equal(
    (await getPricingStore(second.id))?.settings?.mapsCredentials,
    null,
  );
  const region = await prisma.shippingRegion.create({
    data: {
      storeId: store.id,
      kind: "DOMESTIC",
      name: "Test destinations",
      coverage: [
        { country: "US", provinces: [] },
        { country: "GB", provinces: [] },
      ],
    },
  });
  const entry = (
    name: string,
    price: string,
  ): ScenarioDraft["rates"][number] => ({
    id: randomUUID(),
    regionId: region.id,
    name,
    description: "",
    price,
  });
  const postal = (value: string): ScenarioDraft["conditions"][number] => ({
    field: "postalCode",
    operator: "eq",
    value,
  });
  const standard = { ...entry("Standard", "8"), minDays: 1, maxDays: 3 };
  await saveScenario(
    shop,
    null,
    null,
    {
      name: "Standard under $100",
      active: true,
      conditions: [
        postal("10001"),
        { field: "cartTotal", operator: "lt", value: "100" },
      ],
      rates: [standard, { ...standard, id: randomUUID() }],
    },
    "USD",
  );
  await saveScenario(
    shop,
    null,
    null,
    {
      name: "Free from $100",
      active: true,
      conditions: [
        postal("10001"),
        { field: "cartTotal", operator: "gte", value: "100" },
      ],
      rates: [{ ...entry("Free Shipping", "0"), serviceCode: "FREE-100" }],
    },
    "USD",
  );
  await assert.rejects(
    saveCombinedRule(shop, null, "", {
      ...emptyCombinedDraft,
      name: "Collision",
      tags: "standard",
      serviceCode: "free-100",
    }),
    /already in use/,
  );
  await saveScenario(
    shop,
    null,
    null,
    {
      name: "Local driving",
      active: true,
      conditions: [
        postal("20001"),
        {
          field: "cartDistance",
          operator: "lte",
          value: "8",
          distanceUnit: "mi",
        },
      ],
      rates: [
        {
          ...entry("Local delivery", ""),
          pricing: {
            mode: "tiered",
            criteria: "cart",
            basis: "distance",
            distanceUnit: "km",
            amountType: "fixed",
            tiers: [
              { min: "0", max: "12", value: "7" },
              { min: "12.001", max: "~", value: "15" },
            ],
          },
        },
      ],
    },
    "USD",
  );
  await saveScenario(
    shop,
    null,
    null,
    {
      name: "UK postcode",
      active: true,
      conditions: [postal("SW1A_")],
      rates: [entry("UK delivery", "9")],
    },
    "USD",
  );
  await saveScenario(
    shop,
    null,
    null,
    {
      name: "Carrier outage",
      active: true,
      conditions: [postal("30301")],
      rates: [
        {
          ...entry("UPS internal", ""),
          liveCarrier: {
            ...newLiveCarrierRate,
            fallback: {
              name: "Carrier backup",
              description: "",
              kind: "fixed",
              value: "18",
            },
          },
        },
      ],
    },
    "USD",
  );

  const signature = signCarrierCallback(store.id, secret);
  const url = new URL(
    `https://test.example/carrier-rates/${store.id}/${signature}`,
  );
  const post = async (
    amount: number,
    options: {
      postal?: string;
      country?: string;
      discount?: number;
      identity?: string;
    } = {},
  ) => {
    const payload = {
      rate: {
        origin: {
          country: "US",
          province: "NY",
          postal_code: "10001",
          address1: "Example Warehouse",
        },
        destination: {
          country: options.country ?? "US",
          postal_code: options.postal ?? "10001",
          name: options.identity ?? "shipflow Test",
        },
        currency: "USD",
        items: [{ quantity: 1, grams: 500, price: amount }],
        order_totals: {
          subtotal_price: amount,
          discount_amount: options.discount ?? 0,
          total_price: amount - (options.discount ?? 0),
        },
      },
    };
    const cart = normalizeCarrierPayload(payload)!;
    const config = (await getPricingStore(store.id))!;
    const simulated = await evaluateStoreCart(config, cart, {
      simulation: true,
    });
    const response = await callback({
      request: new Request(url, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
      }),
      params: { storeId: store.id, signature },
      context: {},
      url,
      pattern: "/carrier-rates/:storeId/:signature",
    } as ActionFunctionArgs);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { rates: simulated.rates });
    return simulated;
  };
  const standardResult = await post(9000);
  assert.deepEqual(
    standardResult.rates.map(({ total_price }) => total_price),
    ["800"],
  );
  assert.equal(standardResult.rates[0].description, "1 – 3 working days");
  assert.ok(!standardResult.rates[0].min_delivery_date);
  assert.ok(
    standardResult.trace?.rates.some(({ deduplicated }) => deduplicated),
  );
  assert.deepEqual(
    (await post(12000)).rates.map(({ total_price, service_code }) => [
      total_price,
      service_code,
    ]),
    [["0", "FREE-100"]],
  );
  assert.equal(
    (await post(12000, { discount: 2500 })).rates[0].service_name,
    "Standard",
  );
  assert.equal(calls, 1);
  assert.equal(
    (await post(10000, { postal: "20001" })).rates[0].total_price,
    "700",
  );
  assert.equal(calls, 3);
  mapsAvailable = false;
  const failed = await post(10000, { postal: "20001" });
  assert.equal(failed.reason, "store-fallback");
  assert.match(failed.trace?.distanceError ?? "", /503/);
  assert.equal(failed.rates[0].total_price, "1000");
  assert.equal(
    (await post(10000, { postal: "30301" })).rates[0].service_name,
    "Carrier backup",
  );
  assert.equal(
    (await post(10000, { postal: "SW1A 1AA", country: "GB" })).rates[0]
      .service_name,
    "UK delivery",
  );
  await prisma.storeSettings.update({
    where: { storeId: store.id },
    data: {
      shippingConfiguration: { ...shippingConfiguration, ukPostal: false },
    },
  });
  assert.equal(
    (await post(10000, { postal: "SW1A 1AA", country: "GB" })).reason,
    "store-fallback",
  );
  assert.equal(
    (await post(10000, { identity: "Someone Else" })).reason,
    "test-mode",
  );
  await prisma.store.update({
    where: { id: store.id },
    data: { testMode: false },
  });
  assert.equal(
    (await post(9000, { identity: "Someone Else" })).rates[0].total_price,
    "800",
  );
  await switchOperatingMode(shop, OperatingMode.DELIVERY_CUSTOMIZATION);
  assert.equal((await post(9000)).reason, "inactive-mode");
  await switchOperatingMode(shop, OperatingMode.CCS_RATES);
  assert.equal((await post(9000)).rates[0].total_price, "800");
  await prisma.store.update({
    where: { id: store.id },
    data: { appEnabled: false },
  });
  assert.equal((await post(9000)).reason, "app-disabled");
  assert.ok(
    await prisma.carrierRequest.count({
      where: { storeId: store.id, reason: "store-fallback" },
    }),
  );
  assert.equal(
    await prisma.carrierRequest.count({ where: { storeId: second.id } }),
    0,
  );

  const sessionId = `offline_${shop}`;
  await prisma.carrierConnection.create({
    data: {
      storeId: store.id,
      carrier: "ups",
      credentials: "encrypted-fixture",
      services: { domestic: [], international: [] },
      revision: randomUUID(),
    },
  });
  await prisma.session.create({
    data: { id: sessionId, shop, state: "", accessToken: "fixture" },
  });
  await prisma.catalogSync.upsert({
    where: { storeId: store.id },
    create: { storeId: store.id, job: "catalog", lease: "inflight" },
    update: { job: "catalog", lease: "inflight" },
  });
  const { action: uninstall } =
    await import("../app/routes/webhooks.app.uninstalled");
  const body = JSON.stringify({ myshopify_domain: shop });
  const uninstallUrl = new URL("https://test.example/webhooks/app/uninstalled");
  const webhook = () =>
    uninstall({
      url: uninstallUrl,
      context: {},
      params: {},
      pattern: "/webhooks/app/uninstalled",
      request: new Request(uninstallUrl, {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Topic": "app/uninstalled",
          "X-Shopify-Shop-Domain": shop,
          "X-Shopify-API-Version": "2026-10",
          "X-Shopify-Webhook-Id": randomUUID(),
          "X-Shopify-Hmac-Sha256": createHmac("sha256", secret)
            .update(body)
            .digest("base64"),
        },
      }),
    } as ActionFunctionArgs);
  assert.equal((await webhook()).status, 200);
  assert.equal((await webhook()).status, 200);
  assert.equal(
    await prisma.session.findUnique({ where: { id: sessionId } }),
    null,
  );
  assert.equal(
    (await prisma.catalogSync.findUnique({ where: { storeId: store.id } }))
      ?.job,
    null,
  );
  assert.equal((await getPricingStore(store.id))?.carrierServiceId, null);
  assert.equal(
    await prisma.carrierConnection.count({ where: { storeId: store.id } }),
    0,
  );
  assert.equal(
    (await getPricingStore(store.id))?.settings?.mapsCredentials,
    null,
  );
  assert.equal(
    await prisma.rateScenario.count({ where: { storeId: store.id } }),
    5,
  );
  console.log(
    "M10 checkout settings, Maps, fallback, History, mode switching, and signed uninstall passed.",
  );
} finally {
  globalThis.fetch = restore.fetch;
  if (restore.secret === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = restore.secret;
  if (restore.key === undefined) delete process.env.SHIPFLOW_CARRIER_KEY;
  else process.env.SHIPFLOW_CARRIER_KEY = restore.key;
  await prisma.session.deleteMany({ where: { shop: { in: [shop, other] } } });
  await prisma.store.deleteMany({
    where: { shopDomain: { in: [shop, other] } },
  });
  await prisma.$disconnect();
}
