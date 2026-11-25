import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import prisma from "../app/db.server";
import {
  normalizeCarrierPayload,
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
import { emptyCombinedDraft } from "../app/models/combined-rates";
import {
  getCombinedRule,
  loadCombinedRules,
  moveCombinedRule,
  saveCombinedRule,
  changeCombinedRules,
  listCombinedRules,
} from "../app/models/combined-rates.server";
import {
  completeOnboarding,
  OperatingMode,
} from "../app/models/shop-settings.server";
import { action } from "../app/routes/carrier-rates";

const shop = `m7-${randomUUID().slice(0, 10)}.myshopify.com`;
const second = `m7-${randomUUID().slice(0, 10)}.myshopify.com`;
const originalSecret = process.env.SHOPIFY_API_SECRET;
const secret = randomUUID();
process.env.SHOPIFY_API_SECRET = secret;
try {
  const [store, other] = await Promise.all([
    completeOnboarding(shop, OperatingMode.CCS_RATES),
    completeOnboarding(second, OperatingMode.CCS_RATES),
  ]);
  await prisma.store.update({
    where: { id: store.id },
    data: {
      carrierServiceId: `gid://shopify/DeliveryCarrierService/${store.id}`,
      ccsStatus: "ENABLED",
    },
  });
  const region = await prisma.shippingRegion.create({
    data: {
      storeId: store.id,
      kind: "DOMESTIC",
      name: "Domestic",
      coverage: [{ country: "US", provinces: [] }],
    },
  });
  const draft = (name: string, price: string, tags: string): ScenarioDraft => ({
    name,
    active: true,
    conditions: [],
    rates: [
      {
        id: randomUUID(),
        regionId: region.id,
        name,
        description: "",
        price,
        tags,
      },
    ],
  });
  await saveScenario(
    shop,
    null,
    null,
    draft("Cake delivery", "5", "cake"),
    "USD",
  );
  const candle = await saveScenario(
    shop,
    null,
    null,
    draft("Candle delivery", "8", "candle"),
    "USD",
  );
  await saveScenario(shop, null, null, draft("Express", "20", ""), "USD");
  const rule = {
    ...emptyCombinedDraft,
    name: "Bundle",
    active: true,
    tags: "cake, candle",
    notes: "Internal combination note",
  };
  const combined = await saveCombinedRule(shop, null, "", rule);
  const fallback = await saveCombinedRule(shop, null, "", {
    ...rule,
    name: "Inactive fallback",
    active: false,
  });
  await assert.rejects(
    () => saveCombinedRule(shop, combined.id, "stale", rule),
    /changed elsewhere/,
  );
  await assert.rejects(
    () => changeCombinedRules(second, [combined.id], "delete"),
    /no longer available/,
  );
  await assert.rejects(
    () => loadCombinedRules(other.id, [combined.id]),
    /no longer available/,
  );
  assert.equal(await getCombinedRule(other.id, combined.id), null);
  await moveCombinedRule(shop, fallback.id, fallback.position, "up");
  const ordered = await listCombinedRules(store.id, {
    search: "",
    status: "all",
    sort: "priority",
    page: 1,
  });
  assert.deepEqual(
    ordered.rows.map(({ id }) => id),
    [fallback.id, combined.id],
  );
  const matches = await listCombinedRules(store.id, {
    search: "bundle",
    status: "active",
    sort: "name",
    page: 1,
  });
  assert.deepEqual(
    matches.rows.map(({ id }) => id),
    [combined.id],
  );
  const persisted = await getCombinedRule(store.id, combined.id);
  assert.equal(persisted?.draft.notes, rule.notes);

  const payload = {
    rate: {
      currency: "USD",
      destination: { country: "US", province: "NY", name: "shipflow Test" },
      items: [{ name: "Test item", quantity: 1, grams: 100, price: 2000 }],
    },
  };
  const cart = normalizeCarrierPayload(payload)!;
  const pricing = (await getPricingStore(store.id))!;
  const signature = signCarrierCallback(store.id, secret);
  const url = new URL(
    `https://test.example/carrier-rates/${store.id}/${signature}`,
  );
  async function checkout(expected: string[]) {
    const simulated = await evaluateStoreCart(pricing, cart, {
      simulation: true,
    });
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
    assert.deepEqual(
      simulated.rates.map(({ total_price }) => total_price),
      expected,
    );
    const history = await prisma.carrierRequest.findFirst({
      where: { storeId: store.id },
      orderBy: { receivedAt: "desc" },
    });
    assert.deepEqual(history?.trace, simulated.trace);
    assert.doesNotMatch(JSON.stringify(history), /Internal combination note/);
  }
  await checkout(["1300", "2000"]);
  const onlyDraft = await evaluateStoreCart(pricing, cart, {
    simulation: true,
    combinedIds: [fallback.id],
  });
  assert.equal(onlyDraft.rates[0].service_name, "Inactive fallback");
  const withoutRules = await evaluateStoreCart(pricing, cart, {
    simulation: true,
    combinedIds: [],
  });
  assert.deepEqual(
    withoutRules.rates.map(({ total_price }) => total_price),
    ["500", "800", "2000"],
  );
  const scenario = (await getScenario(store.id, candle.id))!;
  await saveScenario(
    shop,
    candle.id,
    scenario.revision,
    {
      ...scenario.draft,
      rates: scenario.draft.rates.map((rate) => ({ ...rate, tags: "" })),
    },
    "USD",
  );
  await checkout(["500", "800", "2000"]);
  await changeCombinedRules(shop, [combined.id], "deactivate");
  assert.deepEqual(await loadCombinedRules(store.id), []);
  assert.equal(
    await prisma.carrierRequest.count({ where: { storeId: store.id } }),
    2,
  );
  console.log(
    "M7 tenant isolation, rule ordering, draft preview, $13 checkout quote and History parity passed.",
  );
} finally {
  await prisma.store.deleteMany({
    where: { shopDomain: { in: [shop, second] } },
  });
  await prisma.$disconnect();
  if (originalSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = originalSecret;
}
