import assert from "node:assert/strict";
import {
  coverageConflict,
  evaluateCarrierCart,
  matchRegion,
  normalizeCarrierPayload,
  parseMoney,
  validateRateCondition,
  validateScenario,
  type CarrierCart,
  type Region,
  type Scenario,
} from "../app/models/calculated-rates";
import type { CheckoutDecisionInput } from "../app/models/checkout-decision";

const domestic: Region = {
  id: "domestic",
  kind: "DOMESTIC",
  name: "Domestic",
  coverage: [{ country: "CA", provinces: [] }],
};
const excluded: Region = {
  id: "quebec",
  kind: "CUSTOM",
  name: "Québec",
  coverage: [{ country: "CA", provinces: ["QC"] }],
};
const rest: Region = {
  id: "rest",
  kind: "REST",
  name: "Rest of the World",
  coverage: [],
};
const regions = [domestic, excluded, rest];
assert.throws(
  () =>
    validateRateCondition(
      { field: "city", operator: "ne", value: ", ," },
      "CAD",
      "kg",
    ),
  /Enter at least one condition value/,
);
assert.equal(
  matchRegion(regions, { country: "CA", province: "ON" })?.id,
  domestic.id,
);
assert.equal(
  matchRegion(regions, { country: "CA", province: "QC" })?.id,
  excluded.id,
);
assert.equal(
  matchRegion(regions, { country: "US", province: "NY" })?.id,
  rest.id,
);
assert.equal(
  matchRegion(regions, { country: "CA", province: null }),
  undefined,
);
assert.equal(
  coverageConflict([{ country: "CA", provinces: ["QC"] }], regions)?.id,
  excluded.id,
);
assert.equal(
  coverageConflict([{ country: "CA", provinces: ["BC"] }], regions),
  undefined,
);
assert.equal(
  coverageConflict([{ country: "CA", provinces: [] }], regions)?.id,
  domestic.id,
);
assert.equal(
  validateScenario(
    { name: "Draft", active: false, conditions: [], rates: [] },
    "CAD",
    "kg",
    [],
  ).rates.length,
  0,
);

const base: CheckoutDecisionInput = {
  mode: "ccs-rates",
  appEnabled: true,
  testMode: true,
  multipleRates: "all",
  rounding: "none",
};
const valid = (
  cartTotal: number,
  province = "ON",
  name: string | null = "Shipflow Test",
) => {
  const payload = {
    rate: {
      origin: { country: "CA" },
      destination: { country: "CA", province, name, postal_code: "M5V 2T6" },
      currency: "CAD",
      locale: "en",
      items: [
        {
          quantity: 2,
          price: 5500,
          grams: 500,
          name: "Test item",
          sku: "TEST-A",
        },
      ],
      order_totals: { subtotal_price: cartTotal, total_price: cartTotal - 100 },
    },
  };
  return normalizeCarrierPayload(payload)!;
};
const condition = validateRateCondition(
  { field: "cartTotal", operator: "gte", value: "100" },
  "CAD",
  "kg",
);
const scenario: Scenario = {
  active: true,
  conditions: [condition],
  rates: [
    {
      id: "rate-a",
      regionId: domestic.id,
      name: "Standard",
      description: "",
      amount: parseMoney("10.00", "CAD"),
      currency: "CAD",
    },
  ],
};
const quote = (cart: CarrierCart, settings = base, rule = scenario) =>
  evaluateCarrierCart(cart, settings, regions, [rule]);
assert.equal(
  quote(valid(9900)).reason,
  "no-match",
  "Uses Shopify's subtotal ahead of the sum of line prices",
);
assert.deepEqual(quote(valid(10_000)).rates, [
  {
    service_name: "Standard",
    service_code: "shipflow-rate-a",
    description: "",
    currency: "CAD",
    total_price: "1000",
  },
]);
assert.equal(quote(valid(10_000, "QC")).rates.length, 0);
assert.equal(
  quote(valid(10_000), base, { ...scenario, active: false }).rates.length,
  0,
);
assert.equal(quote(valid(10_000, "ON", "Regular Buyer")).reason, "test-mode");
assert.equal(quote(valid(10_000, "ON", null)).reason, "test-mode");
assert.equal(
  quote(valid(10_000), { ...base, mode: "delivery-customization" }).reason,
  "inactive-mode",
);
assert.equal(
  quote(valid(10_000), { ...base, appEnabled: false }).reason,
  "app-disabled",
);
assert.equal(
  quote(valid(10_000), base, {
    ...scenario,
    conditions: [
      condition,
      validateRateCondition(
        { field: "customerTag", operator: "ne", value: "wholesale" },
        "CAD",
        "kg",
      ),
    ],
  }).rates.length,
  0,
  "Missing tags cannot satisfy a negative condition",
);
assert.equal(
  quote(valid(10_000), base, {
    ...scenario,
    conditions: [
      condition,
      validateRateCondition(
        { field: "postalCode", operator: "eq", value: "M5V_" },
        "CAD",
        "kg",
      ),
    ],
  }).rates.length,
  1,
);
assert.equal(quote({ ...valid(10_000), currency: "USD" }).rates.length, 0);
assert.equal(
  quote({ ...valid(10_000), currency: "JPY" }, base, {
    ...scenario,
    conditions: [],
    rates: [{ ...scenario.rates[0], currency: "JPY", amount: 1000 }],
  }).rates[0].total_price,
  "100000",
);
assert.equal(
  normalizeCarrierPayload({ rate: { destination: {}, items: [] } }),
  null,
);
console.log(
  "M4 callback normalization, region precedence, AND conditions, money and Test Mode passed.",
);
