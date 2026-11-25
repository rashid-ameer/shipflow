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
import { normalizeCarrierPayload } from "../app/models/calculated-rates";
import {
  evaluateStoreCart,
  getPricingStore,
} from "../app/models/checkout-pricing.server";
import {
  getCarrierRequest,
  historyCustomerExport,
  listCarrierRequests,
  recordHistoryDataRequest,
} from "../app/models/checkout-history.server";
import {
  historyFilters,
  type CartSnapshot,
} from "../app/models/checkout-history";

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

function carrierPayload(subtotal: number, province: string, name: string) {
  return {
    rate: {
      currency: "CAD",
      destination: {
        country: "CA",
        province,
        name,
        address1: "Private street",
        zip: "12345",
      },
      origin: { country: "CA", province: "ON" },
      items: [
        {
          quantity: 1,
          grams: 10,
          price: subtotal,
          name: "Test product",
          variant_id: 123,
        },
      ],
      customer: { id: 456, tags: ["private-customer-tag"] },
      order_totals: { subtotal_price: subtotal },
    },
  };
}
async function call(
  store: string,
  subtotal: number,
  province = "ON",
  name = "shipflow Test",
  token = signCarrierCallback(store, secret),
  malformed = false,
) {
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
      body: malformed
        ? "{"
        : JSON.stringify(carrierPayload(subtotal, province, name)),
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
  const inactive = await getPricingStore(first.id);
  const dryRun = await evaluateStoreCart(
    inactive!,
    normalizeCarrierPayload(carrierPayload(10000, "ON", "shipflow Test"))!,
    { simulation: true, scenarioIds: [scenario.id] },
  );
  assert.equal(
    dryRun.rates[0].total_price,
    "1000",
    "Selected inactive draft is previewable without enabling it",
  );
  await assert.rejects(
    () =>
      evaluateStoreCart(
        {
          ...inactive!,
          id: second.id,
        },
        normalizeCarrierPayload(carrierPayload(10000, "ON", "shipflow Test"))!,
        { simulation: true, scenarioIds: [scenario.id] },
      ),
    /no longer available/,
  );
  await changeScenarios(first.shopDomain, [scenario.id], "activate");
  assert.deepEqual(await (await call(first.id, 9900)).json(), { rates: [] });
  const matched = await (await call(first.id, 10000)).json();
  assert.equal(
    (await call(first.id, 10000, "ON", "shipflow Test", undefined, true))
      .status,
    400,
  );
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
      "no-active-scenarios",
      "unmatched-conditions",
      "no-region-rate",
      "invalid-request",
      "test-mode",
      "app-disabled",
      "inactive-mode",
    ]),
  );
  assert.equal(
    logs.length,
    8,
    "Simulator and unauthorized callbacks create no History records",
  );
  assert.equal(
    logs.find(({ reason }) => reason === "invalid-request")?.statusCode,
    400,
  );
  for (const price of [9900, 10000]) {
    const expected = await evaluateStoreCart(
      (await getPricingStore(first.id))!,
      normalizeCarrierPayload(carrierPayload(price, "ON", "shipflow Test"))!,
      { simulation: true },
    );
    const logged = logs.find((entry) => entry.reason === expected.reason);
    assert.deepEqual(logged?.trace, expected.trace);
    const snapshot = logged?.snapshot as CartSnapshot;
    assert.equal(snapshot.subtotal, price);
    assert.equal(snapshot.lines[0].variantId, "123");
    assert.equal(logged?.customerId, "456");
    assert.doesNotMatch(
      JSON.stringify(logged),
      /Private street|private-customer-tag|12345|shipflow Test/,
    );
  }
  const prior = await prisma.carrierRequest.create({
    data: {
      storeId: first.id,
      receivedAt: new Date(Date.now() - 31 * 86400000),
      country: "CA",
      currency: "CAD",
      testIdentity: "missing",
      reason: "no-match",
      rateCount: 0,
    },
  });
  const recentId = logs.find(({ reason }) => reason === "matched")!.id;
  assert.equal(
    (
      await listCarrierRequests(
        first.id,
        historyFilters(new URLSearchParams()),
        [],
      )
    ).rows.length,
    8,
  );
  assert.equal(
    (
      await listCarrierRequests(
        first.id,
        historyFilters(new URLSearchParams({ q: recentId })),
        [],
      )
    ).rows[0].id,
    recentId,
  );
  assert.equal(
    (
      await listCarrierRequests(
        first.id,
        historyFilters(new URLSearchParams({ q: "Example" })),
        ["456"],
      )
    ).rows.length,
    7,
  );
  assert.equal(await getCarrierRequest(first.id, prior.id), null);
  assert.equal(await getCarrierRequest(second.id, recentId), null);
  await recordHistoryDataRequest(first.shopDomain, "987", "456");
  await recordHistoryDataRequest(first.shopDomain, "987", "456");
  const exported = await historyCustomerExport(first.shopDomain, "987");
  assert.equal(exported?.history.length, 7);
  assert.equal(await historyCustomerExport(second.shopDomain, "987"), null);
  const dated = historyFilters(
    new URLSearchParams({ from: "2026-09-01", to: "2026-11-26" }),
    new Date("2026-11-25T12:00:00Z"),
  );
  assert.equal(dated.start.toISOString(), "2026-10-26T12:00:00.000Z");
  assert.equal(dated.end.toISOString(), "2026-11-25T12:00:00.001Z");
  await prisma.rateCondition.updateMany({
    where: { scenarioId: scenario.id, scenario: { storeId: first.id } },
    data: { condition: { field: "broken-fixture" } },
  });
  assert.equal((await call(first.id, 10000)).status, 500);
  assert.ok(
    await prisma.carrierRequest.findFirst({
      where: { storeId: first.id, reason: "evaluation-error", statusCode: 500 },
    }),
  );
  assert.equal(
    await prisma.carrierRequest.count({ where: { storeId: second.id } }),
    0,
  );
  console.log(
    "M4–M5 PostgreSQL isolation, callback parity, History filters, error records, and customer export passed.",
  );
} finally {
  await prisma.store.deleteMany({ where: { shopDomain: { in: shops } } });
  await prisma.$disconnect();
  if (oldSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = oldSecret;
  if (oldOrigin === undefined) delete process.env.SHOPIFY_APP_URL;
  else process.env.SHOPIFY_APP_URL = oldOrigin;
}
