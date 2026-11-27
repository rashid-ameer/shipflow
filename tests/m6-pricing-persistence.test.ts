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
import {
  completeOnboarding,
  OperatingMode,
  updateBasicSettings,
} from "../app/models/shop-settings.server";
import { action } from "../app/routes/carrier-rates";

const shop = `m6-${randomUUID().slice(0, 10)}.myshopify.com`;
const secret = randomUUID();
const originalSecret = process.env.SHOPIFY_API_SECRET;
process.env.SHOPIFY_API_SECRET = secret;

try {
  const store = await completeOnboarding(shop, OperatingMode.CCS_RATES);
  await prisma.store.update({
    where: { id: store.id },
    data: {
      carrierServiceId: `gid://shopify/DeliveryCarrierService/${store.id}`,
      ccsStatus: "ENABLED",
    },
  });
  await updateBasicSettings(shop, {
    appEnabled: true,
    weightUnit: "kg",
    distanceUnit: "km",
    dimensionUnit: "cm",
    volumetricDivisor: 5000,
    multipleRates: "all",
    rounding: "none",
    discountedCartTotal: true,
  });
  const region = await prisma.shippingRegion.create({
    data: {
      storeId: store.id,
      kind: "DOMESTIC",
      name: "Domestic",
      coverage: [{ country: "US", provinces: [] }],
    },
  });
  const rate = {
    id: randomUUID(),
    regionId: region.id,
    name: "Cart tier",
    description: "Standard",
    price: "",
  };
  const draft: ScenarioDraft = {
    name: "M6 demo",
    active: true,
    conditions: [{ field: "cartQuantity", operator: "gte", value: "1" }],
    rates: [
      {
        ...rate,
        pricing: {
          mode: "tiered",
          criteria: "cart",
          basis: "total",
          amountType: "fixed",
          tiers: [
            { min: "50", max: "100", value: "10" },
            { min: "100", max: "~", value: "18" },
          ],
        },
      },
      {
        ...rate,
        id: randomUUID(),
        name: "Per kg",
        tags: "special, heavy",
        notes: "Private merchant note",
        pricing: {
          mode: "incremental",
          criteria: "product",
          basis: "weight",
          amountType: "fixed",
          filter: { field: "sku", operator: "starts", value: "BOX" },
          aggregate: "combine",
          increment: {
            base: "4",
            rate: "5",
            step: "1",
            skip: "1",
            rounding: "none",
          },
          discount: { kind: "percent", basis: "shipping", value: "10" },
          handling: { kind: "fixed", basis: "shipping", value: "2" },
          insurance: { kind: "fixed", basis: "shipping", value: "1" },
          maximum: "18.25",
        },
      },
      {
        ...rate,
        id: randomUUID(),
        name: "Inactive flat",
        price: "1",
        active: false,
      },
      { ...rate, id: randomUUID(), name: "Legacy flat", price: "7.50" },
    ],
  };
  const scenario = await saveScenario(shop, null, null, draft, "USD");
  const saved = await getScenario(store.id, scenario.id);
  assert.equal(saved?.draft.rates[1].pricing?.weightUnit, "kg");
  assert.equal(saved?.draft.rates[1].notes, "Private merchant note");
  assert.equal(saved?.draft.rates[1].tags, "special, heavy");
  assert.equal(saved?.draft.rates[3].price, "7.50");
  await updateBasicSettings(shop, {
    appEnabled: true,
    weightUnit: "lb",
    distanceUnit: "km",
    dimensionUnit: "cm",
    volumetricDivisor: 5000,
    multipleRates: "all",
    rounding: "none",
    discountedCartTotal: true,
  });
  await saveScenario(shop, scenario.id, saved!.revision, saved!.draft, "USD");
  const current = (await getPricingStore(store.id))!;
  const signature = signCarrierCallback(store.id, secret);
  const url = new URL(
    `https://test.example/carrier-rates/${store.id}/${signature}`,
  );
  for (const [subtotal, expected] of [
    [9999, "1000"],
    [10000, "1000"],
    [10001, "1800"],
  ] as const) {
    const payload = {
      rate: {
        currency: "USD",
        destination: { country: "US", province: "NY", name: "shipflow Test" },
        items: [
          {
            variant_id: 4321,
            name: "Heavy box",
            sku: "BOX-1",
            quantity: 2,
            grams: 2000,
            price: 6000,
          },
        ],
        order_totals: { subtotal_price: 12000, total_price: subtotal },
      },
    };
    const simulated = await evaluateStoreCart(
      current,
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
    assert.deepEqual(
      simulated.rates.map(({ total_price }) => total_price),
      [expected, "1825", "750"],
    );
    assert.equal(simulated.trace?.pricingSubtotal, subtotal);
    assert.equal(simulated.trace?.rejectedRates?.[0].reason, "inactive");
    const record = await prisma.carrierRequest.findFirst({
      where: { storeId: store.id },
      orderBy: { receivedAt: "desc" },
    });
    assert.deepEqual(record?.trace, simulated.trace);
    assert.doesNotMatch(
      JSON.stringify(record),
      /Private merchant note|shipflow Test/,
    );
  }
  assert.equal(
    await prisma.carrierRequest.count({ where: { storeId: store.id } }),
    3,
  );
  console.log(
    "M6 PostgreSQL save/reopen, stored weight units, checkout/Simulator parity and History breakdown passed.",
  );
} finally {
  await prisma.store.deleteMany({ where: { shopDomain: shop } });
  await prisma.$disconnect();
  if (originalSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = originalSecret;
}
