import assert from "node:assert/strict";
import {
  combineShippingRates,
  emptyCombinedDraft,
  validateCombinedDraft,
  type CombinedRule,
  type CombinableRate,
} from "../app/models/combined-rates";
import {
  evaluateCarrierCart,
  type CarrierCart,
  type Region,
  type Scenario,
} from "../app/models/calculated-rates";
import type { CheckoutDecisionInput } from "../app/models/checkout-decision";

const baseRule: CombinedRule = {
  id: "bundle",
  ...validateCombinedDraft({
    ...emptyCombinedDraft,
    name: "Bundle shipping",
    active: true,
    tags: "cake, candle, CAKE",
  }),
};
assert.deepEqual(baseRule.tags, ["cake", "candle"]);
assert.throws(
  () =>
    validateCombinedDraft({
      ...emptyCombinedDraft,
      name: "Bundle",
      requireTwoTags: true,
      tags: "One, one",
    }),
  /two distinct/,
);
assert.throws(
  () =>
    validateCombinedDraft({
      ...emptyCombinedDraft,
      name: "Bundle",
      tags: "one",
      minDays: "4",
      maxDays: "3",
    }),
  /Latest delivery/,
);
const sources: CombinableRate[] = [
  {
    id: "cake",
    name: "Cake delivery",
    amountInMinorUnits: 500,
    tags: ["Cake", "gift"],
    priority: 0,
  },
  {
    id: "express",
    name: "Express",
    amountInMinorUnits: 2000,
    tags: [],
    priority: 1,
  },
  {
    id: "candle",
    name: "Candle delivery",
    amountInMinorUnits: 800,
    tags: ["candle"],
    priority: 2,
  },
];
function apply(patch: Partial<CombinedRule> = {}, input = sources) {
  return combineShippingRates(input, [{ ...baseRule, ...patch }]);
}
assert.deepEqual(
  apply().rates.map(({ id, amountInMinorUnits }) => [id, amountInMinorUnits]),
  [
    ["combined-bundle", 1300],
    ["express", 2000],
  ],
);
assert.deepEqual(
  apply().steps[0].sources.map(({ id }) => id),
  ["cake", "candle"],
);
assert.equal(apply({ method: "average" }).rates[0].amountInMinorUnits, 650);
assert.equal(
  apply(
    { method: "average" },
    sources.map((rate) =>
      rate.id === "candle" ? { ...rate, amountInMinorUnits: 801 } : rate,
    ),
  ).rates[0].amountInMinorUnits,
  651,
);
assert.equal(
  apply({ method: "highest", useWinningName: true }).rates[0].name,
  "Candle delivery",
);
assert.equal(
  apply({ method: "lowest", useWinningName: true }).rates[0].amountInMinorUnits,
  500,
);
assert.equal(apply({ method: "lowest" }).rates[0].name, "Bundle shipping");
assert.deepEqual(apply({ active: false }).rates, sources);
assert.deepEqual(apply({ blockingTags: ["GIFT"] }).rates, sources);
assert.deepEqual(
  apply({ excludedTags: ["candle"] }).rates.map(
    ({ id, amountInMinorUnits }) => [id, amountInMinorUnits],
  ),
  [
    ["combined-bundle", 500],
    ["express", 2000],
    ["candle", 800],
  ],
);
assert.deepEqual(apply({ excludedTags: ["cake", "candle"] }).rates, sources);
const changed = sources.map((rate) =>
  rate.id === "candle" ? { ...rate, tags: [] } : rate,
);
assert.deepEqual(apply({}, changed).rates, changed);
assert.equal(
  apply({ requirement: "any" }, changed).rates[0].id,
  "combined-bundle",
);
assert.deepEqual(
  apply({ requirement: "any", requireTwoTags: true }, changed).rates,
  changed,
);
assert.deepEqual(
  apply({ tags: ["cake", "gift"], requireTwoTags: true }).rates.map(
    ({ id }) => id,
  ),
  ["combined-bundle", "express", "candle"],
);

const first: CombinedRule = { ...baseRule, outputTag: "wrapped" };
const competing: CombinedRule = {
  ...baseRule,
  id: "competing",
  tags: ["cake"],
};
const nested: CombinedRule = {
  ...baseRule,
  id: "nested",
  tags: ["wrapped"],
  method: "highest",
  useWinningName: true,
};
const ordered = combineShippingRates(sources, [first, competing, nested]);
assert.deepEqual(
  ordered.rates.map(({ id, amountInMinorUnits }) => [id, amountInMinorUnits]),
  [
    ["combined-nested", 1300],
    ["express", 2000],
  ],
);
assert.equal(ordered.steps[2].sources[0].id, "combined-bundle");
assert.deepEqual(
  combineShippingRates(sources, [competing, first]).rates.map(({ id }) => id),
  ["combined-competing", "express", "candle"],
);
assert.deepEqual(
  apply(
    {},
    sources.map((rate) => ({ ...rate, amountInMinorUnits: 2_000_000_000 })),
  ).rates.map(({ id }) => id),
  ["cake", "express", "candle"],
);

const region: Region = {
  id: "domestic",
  name: "Domestic",
  kind: "DOMESTIC",
  coverage: [{ country: "US", provinces: [] }],
};
const cart: CarrierCart = {
  currency: "USD",
  firstName: "shipflow",
  subtotal: 2000,
  destination: { country: "US", province: null },
  lines: [{ quantity: 1, grams: 500, price: 2000 }],
};
const settings: CheckoutDecisionInput = {
  appEnabled: true,
  mode: "ccs-rates",
  testMode: true,
  multipleRates: "lowest",
  rounding: "nearest-one",
};
const scenario: Scenario = {
  active: true,
  conditions: [],
  rates: sources.map(({ id, tags, name, amountInMinorUnits }) => ({
    id,
    tags,
    name,
    regionId: region.id,
    currency: "USD",
    description: "Original rate",
    amount: amountInMinorUnits + 10,
  })),
};
const priced = evaluateCarrierCart(
  cart,
  settings,
  [region],
  [scenario],
  [{ ...baseRule, minDays: 2, maxDays: 4, description: "Bundle details" }],
);
assert.equal(priced.rates.length, 1);
assert.equal(priced.rates[0].total_price, "1300");
assert.equal(priced.rates[0].service_code, "shipflow-combined-bundle");
assert.equal(priced.rates[0].description, "Bundle details");
assert.match(
  priced.rates[0].min_delivery_date!,
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \+0000$/,
);
assert.equal(
  priced.trace?.rates.find((rate) => rate.id === "cake")?.consumedBy,
  "Bundle shipping",
);
assert.deepEqual(priced.trace?.checkoutRateIds, ["combined-bundle"]);
assert.equal(
  evaluateCarrierCart(
    { ...cart, firstName: null },
    settings,
    [region],
    [scenario],
    [baseRule],
  ).trace,
  null,
);
console.log(
  "M7 calculation methods, tag rules, nested ordering, selection, rounding and delivery estimates passed.",
);
