import assert from "node:assert/strict";
import {
  evaluateCarrierCart,
  validateRateCondition,
  type CarrierCart,
  type FixedRate,
  type Region,
  type Scenario,
} from "../app/models/calculated-rates";
import {
  quoteRate,
  validateRatePricing,
  type RatePricing,
} from "../app/models/rate-pricing";
import { addPricingInputs } from "../app/models/checkout-pricing-inputs.server";
import type { CheckoutDecisionInput } from "../app/models/checkout-decision";
import type { AdminQuery } from "../app/models/delivery-customization-admin.server";

const region: Region = {
  id: "domestic",
  name: "Domestic",
  kind: "DOMESTIC",
  coverage: [{ country: "US", provinces: [] }],
};
const cart: CarrierCart = {
  currency: "USD",
  destination: { country: "US", province: "NY" },
  firstName: "shipflow",
  subtotal: 10000,
  lines: [
    {
      variantId: "123",
      name: "Box",
      grams: 2000,
      quantity: 2,
      price: 4000,
      sku: "BOX-1",
      tags: ["fragile", "seasonal"],
    },
    {
      variantId: "124",
      name: "Tape",
      grams: 500,
      quantity: 1,
      price: 2000,
      sku: "TAPE-1",
      tags: ["seasonal"],
    },
  ],
};
const flat: FixedRate = {
  id: "flat",
  regionId: region.id,
  name: "Standard",
  description: "",
  currency: "USD",
  amount: 1200,
};
const settings: CheckoutDecisionInput = {
  appEnabled: true,
  mode: "ccs-rates",
  testMode: true,
  multipleRates: "all",
  rounding: "none",
};
const tiered = validateRatePricing(
  {
    mode: "tiered",
    criteria: "cart",
    basis: "total",
    amountType: "fixed",
    tiers: [
      { min: "50", max: "100", value: "10" },
      { min: "100", max: "~", value: "18" },
    ],
  },
  "USD",
  "kg",
);
const tierRate = { ...flat, pricing: tiered };
function amount(rate: FixedRate, input: CarrierCart) {
  const result = quoteRate(rate, input);
  assert.ok("amount" in result);
  return result.amount;
}
assert.deepEqual(quoteRate(tierRate, { ...cart, subtotal: 4999 }), {
  reason: "no-tier",
  detail: "49.99 USD",
});
assert.equal(amount(tierRate, { ...cart, subtotal: 5000 }), 1000);
assert.equal(
  amount(tierRate, cart),
  1000,
  "The first tier wins on a shared inclusive boundary",
);
assert.equal(amount(tierRate, { ...cart, subtotal: 10001 }), 1800);
assert.equal(amount(tierRate, { ...cart, subtotal: 900000 }), 1800);
assert.equal(
  amount(
    { ...flat, pricing: { ...tiered, tiers: [...tiered.tiers!].reverse() } },
    cart,
  ),
  1800,
);
assert.throws(
  () =>
    validateRatePricing(
      { ...tiered, tiers: [{ min: "10", max: "9", value: "1" }] },
      "USD",
      "kg",
    ),
  /maximum/,
);

const incremental = validateRatePricing(
  {
    mode: "incremental",
    criteria: "product",
    basis: "weight",
    amountType: "fixed",
    filter: { field: "sku", operator: "starts", value: "BOX" },
    aggregate: "combine",
    increment: { base: "4", rate: "5", step: "1", skip: "1", rounding: "none" },
    discount: {
      kind: "percent",
      value: "10",
      basis: "shipping",
      minimum: "10",
      minimumBasis: "shipping",
    },
    handling: { kind: "fixed", value: "2", basis: "shipping" },
    insurance: { kind: "fixed", value: "1", basis: "shipping" },
    maximum: "18.25",
  },
  "USD",
  "kg",
);
const incrementalRate = { ...flat, id: "incremental", pricing: incremental };
const quoted = quoteRate(incrementalRate, cart);
assert.ok("amount" in quoted);
assert.deepEqual(
  quoted.steps.map(({ amount }) => amount),
  [1900, 1710, 1910, 2010, 1825],
);
const individual = {
  ...incrementalRate,
  pricing: { ...incremental, individual: true },
};
assert.equal(
  amount(individual, cart),
  1200,
  "Unit weight sets a 2 kg basis and the discount minimum is not met",
);
assert.equal(
  amount(
    {
      ...incrementalRate,
      pricing: {
        ...incremental,
        discount: undefined,
        handling: undefined,
        insurance: undefined,
        maximum: undefined,
        increment: { ...incremental.increment!, rounding: "ceil" },
      },
    },
    { ...cart, lines: [{ ...cart.lines[0], grams: 1250, quantity: 1 }] },
  ),
  600,
);
assert.throws(
  () =>
    validateRatePricing(
      { ...incremental, increment: { ...incremental.increment!, step: "0" } },
      "USD",
      "kg",
    ),
  /step/,
);

const grouped: RatePricing = {
  mode: "tiered",
  criteria: "product",
  basis: "quantity",
  amountType: "fixed",
  filter: { field: "tags", operator: "eq", value: "fragile, seasonal" },
  aggregate: "group",
  tiers: [{ min: "1", max: "~", value: "6" }],
};
assert.equal(amount({ ...flat, pricing: grouped }, cart), 1200);
assert.equal(
  amount({ ...flat, pricing: { ...grouped, aggregate: "combine" } }, cart),
  600,
);
assert.equal(
  amount(
    {
      ...flat,
      pricing: {
        ...grouped,
        amountType: "percent",
        aggregate: "combine",
        tiers: [{ min: "1", max: "~", value: "10" }],
      },
    },
    cart,
  ),
  1000,
);
assert.deepEqual(
  quoteRate(
    { ...flat, pricing: grouped },
    { ...cart, lines: [{ ...cart.lines[0], tags: undefined }] },
  ),
  { reason: "missing-input" },
);

const scenario = (
  rate: FixedRate,
  condition?: Parameters<typeof validateRateCondition>[0],
): Scenario => ({
  name: "Demo",
  active: true,
  rates: [rate],
  conditions: condition ? [validateRateCondition(condition, "USD", "kg")] : [],
});
const price = (input: CarrierCart, rules: Scenario[], options = settings) =>
  evaluateCarrierCart(input, options, [region], rules);
const selected = price(cart, [scenario(incrementalRate), scenario(flat)], {
  ...settings,
  multipleRates: "highest",
  rounding: "ceil",
});
assert.equal(selected.rates[0].total_price, "1900");
assert.equal(
  selected.trace?.rates[0].steps?.at(-1)?.label,
  "Settings rounding",
);
assert.equal(selected.trace?.rates[1].finalAmount, null);
assert.equal(
  price(cart, [scenario({ ...flat, active: false })]).trace?.rejectedRates?.[0]
    .reason,
  "inactive",
);
assert.equal(
  price(cart, [
    scenario(flat, { field: "previousOrders", operator: "ne", value: "2" }),
  ]).trace?.scenarios[0].conditions[0].outcome,
  "missing",
);
assert.equal(
  price(cart, [
    scenario(flat, {
      field: "productQuantity",
      operator: "gte",
      value: "2",
      scope: "tag-filter",
      scopeValue: "fragile",
    }),
  ]).rates.length,
  1,
);
assert.equal(
  price({ ...cart, postalCode: "HB1 2BA" }, [
    scenario(flat, {
      field: "postalCode",
      operator: "eq",
      value: "HB1_,100400:100500",
    }),
  ]).rates.length,
  1,
);
assert.equal(
  price({ ...cart, postalCode: "HB12 C2" }, [
    scenario(flat, { field: "postalCode", operator: "eq", value: "HB1_" }),
  ]).rates.length,
  0,
);
assert.equal(
  price(cart, [
    scenario(flat, {
      field: "province",
      operator: "ne",
      value: "QC",
      provinceCountry: "CA",
    }),
  ]).rates.length,
  0,
);

let lookupCount = 0;
const graphql: AdminQuery = async (query, { variables } = {}) => {
  lookupCount++;
  if (query.includes("ShipFlowPricingVariantData")) {
    assert.deepEqual(variables, {
      ids: [
        "gid://shopify/ProductVariant/123",
        "gid://shopify/ProductVariant/124",
      ],
      collections: true,
    });
    return Response.json({
      data: {
        nodes: (variables!.ids as string[]).map((id) => ({
          id,
          barcode: "042",
          sku: "BOX-1",
          product: {
            id: "gid://shopify/Product/1",
            title: "Box",
            vendor: "ShipFlow",
            productType: "Supply",
            tags: ["fragile"],
            collections: {
              nodes: [{ title: "First page" }],
              pageInfo: { hasNextPage: true, endCursor: "next" },
            },
          },
        })),
      },
    });
  }
  if (query.includes("ShipFlowPricingCollections"))
    return Response.json({
      data: {
        product: {
          collections: {
            nodes: [{ title: "Shipping supplies" }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    });
  return Response.json({
    data: {
      customer: {
        firstName: "Private",
        lastName: "Person",
        numberOfOrders: "3",
        amountSpent: { amount: "20.00", currencyCode: "USD" },
      },
    },
  });
};
const ruleWithData = scenario(flat, {
  field: "productCollection",
  operator: "eq",
  value: "Shipping supplies",
  scope: "all",
});
const customerRule = scenario(flat, {
  field: "previousOrders",
  operator: "gte",
  value: "3",
});
const hydrated = await addPricingInputs(
  { ...cart, customerId: "5" },
  [region],
  [ruleWithData, customerRule],
  async () => graphql,
);
assert.equal(
  lookupCount,
  3,
  "Collection pagination is shared by variants of the same product",
);
assert.equal(price(hydrated, [ruleWithData]).rates.length, 1);
assert.equal(price(hydrated, [customerRule]).rates.length, 1);
await addPricingInputs(cart, [region], [scenario(flat)], async () => {
  throw new Error("No Admin lookup needed");
});
console.log(
  "M6 ordered tiers, increments, grouping, adjustments, condition coverage and Shopify input hydration passed.",
);
