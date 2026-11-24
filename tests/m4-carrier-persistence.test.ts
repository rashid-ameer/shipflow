import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import prisma from "../app/db.server";
import {
  completeOnboarding,
  getOrCreateShop,
  OperatingMode,
} from "../app/models/shop-settings.server";
import {
  CarrierSetupError,
  connectCarrierService,
  getCarrierSetup,
  signCarrierCallback,
} from "../app/models/carrier-shopify.server";
import {
  changeScenarios,
  deleteRegion,
  listRegions,
  loadRatesContext,
  saveRegion,
  saveScenario,
} from "../app/models/calculated-rates.server";
import type { AdminQuery } from "../app/models/delivery-customization-admin.server";
import { action as quote } from "../app/routes/carrier-rates";

const secret = randomUUID();
const oldSecret = process.env.SHOPIFY_API_SECRET;
const oldOrigin = process.env.SHOPIFY_APP_URL;
process.env.SHOPIFY_API_SECRET = secret;
process.env.SHOPIFY_APP_URL = "https://rates-test.example.com";
const shops = [
  `m4-${randomUUID().slice(0, 10)}.myshopify.com`,
  `m4-${randomUUID().slice(0, 10)}.myshopify.com`,
];
let registered: { id: string; active: boolean; callbackUrl: string } | null =
  null;
let creates = 0;
const graphql: AdminQuery = async (query, options) => {
  if (query.includes("ShipFlowRatesContext"))
    return Response.json({
      data: {
        shop: { currencyCode: "CAD", shopAddress: { countryCodeV2: "CA" } },
      },
    });
  if (query.includes("ShipFlowCarrierServices"))
    return Response.json({
      data: {
        carrierServices: {
          nodes: registered ? [registered] : [],
          pageInfo: { hasNextPage: false },
        },
      },
    });
  if (query.includes("ShipFlowCarrierCreate")) {
    const input = options?.variables?.input as { callbackUrl: string };
    creates++;
    registered = {
      id: `gid://shopify/DeliveryCarrierService/${Date.now()}`,
      active: true,
      callbackUrl: input.callbackUrl,
    };
    throw new Error("Response lost after Shopify created the Carrier Service");
  }
  if (query.includes("ShipFlowCarrierProfile"))
    return Response.json({
      data: {
        deliveryProfiles: {
          nodes: [
            {
              profileLocationGroups: [
                {
                  locationGroupZones: {
                    nodes: [
                      {
                        methodDefinitions: {
                          nodes: [
                            {
                              active: true,
                              rateProvider: { carrierService: registered },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    });
  throw new Error("Unexpected Admin operation");
};

async function call(
  store: string,
  subtotal: number,
  province = "ON",
  name = "shipflow Test",
  token = signCarrierCallback(store, secret),
) {
  const payload = {
    rate: {
      currency: "CAD",
      destination: { country: "CA", province, name },
      items: [{ quantity: 1, grams: 10, price: subtotal }],
      order_totals: { subtotal_price: subtotal },
    },
  };
  const url = new URL("https://rates-test.example.com/carrier-rates");
  return quote({
    url,
    pattern: "/carrier-rates/:storeId/:signature",
    request: new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Shop-Domain": shops[1],
      },
      body: JSON.stringify(payload),
    }),
    params: { storeId: store, signature: token },
    context: {},
  } as ActionFunctionArgs);
}

try {
  for (const domain of shops)
    await completeOnboarding(domain, OperatingMode.CCS_RATES);
  const first = await getOrCreateShop(shops[0]);
  const second = await getOrCreateShop(shops[1]);
  await loadRatesContext(graphql, first);
  const domestic = (await listRegions(first.id)).find(
    (region) => region.kind === "DOMESTIC",
  )!;
  assert.equal(domestic.coverage[0].country, "CA");
  await assert.rejects(
    () => deleteRegion(first.shopDomain, domestic.id, 0),
    /at least one/,
  );
  await assert.rejects(
    () =>
      saveRegion(second.shopDomain, domestic.id, "Other", [
        { country: "CA", provinces: [] },
      ]),
    /cannot be edited/,
  );
  const other = await saveRegion(first.shopDomain, null, "Québec", [
    { country: "CA", provinces: ["QC"] },
  ]);
  assert.equal((await listRegions(second.id)).length, 0);
  const draft = {
    name: "Standard after $100",
    active: false,
    conditions: [{ field: "cartTotal", operator: "gte", value: "100" }],
    rates: [
      {
        id: randomUUID(),
        regionId: domestic.id,
        name: "Standard",
        description: "",
        price: "10",
      },
    ],
  };
  const scenario = await saveScenario(
    first.shopDomain,
    null,
    null,
    draft,
    "CAD",
  );
  await assert.rejects(
    () => changeScenarios(first.shopDomain, [scenario.id], "activate"),
    /Connect the Carrier Service/,
  );
  await assert.rejects(
    () => changeScenarios(second.shopDomain, [scenario.id], "delete"),
    /no longer available/,
  );
  const ccsUnavailable: AdminQuery = (query, options) =>
    query.includes("ShipFlowCarrierCreate")
      ? Promise.resolve(
          Response.json({
            data: {
              carrierServiceCreate: {
                carrierService: null,
                userErrors: [
                  {
                    code: "CARRIER_SERVICE_CREATE_FAILED",
                    message:
                      "Carrier Calculated Shipping must be enabled for your store before enabling: ShipFlow",
                  },
                ],
              },
            },
          }),
        )
      : graphql(query, options);
  await assert.rejects(
    () => connectCarrierService(ccsUnavailable, first.shopDomain),
    (error) =>
      error instanceof CarrierSetupError && error.code === "CCS_UNAVAILABLE",
  );
  assert.equal(
    (await getOrCreateShop(first.shopDomain)).carrierServiceId,
    null,
  );
  await assert.rejects(
    () => connectCarrierService(graphql, first.shopDomain),
    /could not confirm/,
  );
  await connectCarrierService(graphql, first.shopDomain);
  assert.equal(
    creates,
    1,
    "Retry reuses the registered service instead of creating a duplicate",
  );
  assert.equal(
    (await getCarrierSetup(graphql, await getOrCreateShop(first.shopDomain)))
      .profileAttached,
    true,
  );
  assert.equal(
    (
      await call(
        second.id,
        10000,
        "ON",
        "shipflow Test",
        signCarrierCallback(first.id, secret),
      )
    ).status,
    401,
  );
  assert.equal(
    (await call(first.id, 10000, "ON", "shipflow Test", "a".repeat(64))).status,
    401,
  );
  assert.deepEqual(await (await call(first.id, 10000)).json(), { rates: [] });
  await changeScenarios(first.shopDomain, [scenario.id], "activate");
  assert.deepEqual(await (await call(first.id, 9900)).json(), { rates: [] });
  const matched = await (await call(first.id, 10000)).json();
  assert.equal(matched.rates[0].total_price, "1000");
  assert.equal(matched.rates[0].service_code, `shipflow-${draft.rates[0].id}`);
  assert.deepEqual(await (await call(first.id, 10000, "QC")).json(), {
    rates: [],
  });
  assert.deepEqual(
    await (await call(first.id, 10000, "ON", "Ordinary Buyer")).json(),
    { rates: [] },
  );
  await prisma.store.update({
    where: { id: first.id },
    data: { appEnabled: false },
  });
  assert.deepEqual(await (await call(first.id, 10000)).json(), { rates: [] });
  await prisma.store.update({
    where: { id: first.id },
    data: { appEnabled: true, mode: "DELIVERY_CUSTOMIZATION" },
  });
  assert.deepEqual(await (await call(first.id, 10000)).json(), { rates: [] });
  await prisma.store.update({
    where: { id: first.id },
    data: { mode: "CCS_RATES" },
  });
  await assert.rejects(
    () => deleteRegion(first.shopDomain, domestic.id, 0),
    /attached rates changed/,
  );
  await deleteRegion(first.shopDomain, other.id, 0);
  const logs = await prisma.carrierRequest.findMany({
    where: { storeId: first.id },
  });
  assert.deepEqual(
    new Set(logs.map(({ reason }) => reason)),
    new Set([
      "matched",
      "no-match",
      "test-mode",
      "app-disabled",
      "inactive-mode",
    ]),
  );
  assert.equal(
    await prisma.carrierRequest.count({ where: { storeId: second.id } }),
    0,
  );
  console.log(
    "M4 PostgreSQL isolation, registration recovery and the production callback action passed.",
  );
} finally {
  await prisma.store.deleteMany({ where: { shopDomain: { in: shops } } });
  await prisma.$disconnect();
  if (oldSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = oldSecret;
  if (oldOrigin === undefined) delete process.env.SHOPIFY_APP_URL;
  else process.env.SHOPIFY_APP_URL = oldOrigin;
}
