import assert from "node:assert/strict";

import {
  decideCheckoutRates,
  isTestCheckout,
  roundAmount,
  selectMultipleRates,
  type CheckoutDecisionInput,
  type CheckoutRate,
} from "../app/models/checkout-decision";

const rates: CheckoutRate[] = [
  { id: "standard", amountInMinorUnits: 1049, priority: 20 },
  { id: "express", amountInMinorUnits: 2099, priority: 10 },
];
const base: CheckoutDecisionInput = {
  appEnabled: true,
  mode: "ccs-rates",
  testMode: false,
  multipleRates: "all",
  rounding: "none",
};

let evaluations = 0;
const evaluator = () => {
  evaluations += 1;
  return rates;
};

assert.deepEqual(
  decideCheckoutRates({ ...base, appEnabled: false }, evaluator),
  { kind: "empty", reason: "app-disabled" },
);
assert.deepEqual(
  decideCheckoutRates({ ...base, mode: "delivery-customization" }, evaluator),
  { kind: "empty", reason: "inactive-mode" },
);
assert.deepEqual(
  decideCheckoutRates(
    { ...base, testMode: true, customerFirstName: "Customer" },
    evaluator,
  ),
  { kind: "empty", reason: "test-mode" },
);
assert.equal(evaluations, 0, "pricing must not run before checkout gates pass");

assert.equal(isTestCheckout("  SHIPFLOW "), true);
assert.equal(isTestCheckout(null), false);
const testDecision = decideCheckoutRates(
  { ...base, testMode: true, customerFirstName: "ShipFlow" },
  evaluator,
);
assert.equal(testDecision.kind, "rates");
assert.equal(evaluations, 1);

assert.deepEqual(
  selectMultipleRates(rates, "highest").map((rate) => rate.id),
  ["express"],
);
assert.deepEqual(
  selectMultipleRates(rates, "lowest").map((rate) => rate.id),
  ["standard"],
);
assert.deepEqual(
  selectMultipleRates(rates, "priority").map((rate) => rate.id),
  ["express"],
);
assert.equal(selectMultipleRates(rates, "all").length, 2);

assert.equal(roundAmount(1049, "none"), 1049);
assert.equal(roundAmount(1049, "nearest-half"), 1050);
assert.equal(roundAmount(1049, "nearest-one"), 1000);
assert.equal(roundAmount(1001, "ceil"), 1100);
assert.equal(roundAmount(1099, "floor"), 1000);

assert.deepEqual(
  decideCheckoutRates(
    {
      ...base,
      fallbackRate: { id: "fallback", amountInMinorUnits: 1299 },
      rounding: "nearest-one",
    },
    () => [],
  ),
  {
    kind: "rates",
    source: "fallback",
    rates: [{ id: "fallback", amountInMinorUnits: 1300 }],
  },
);
assert.deepEqual(
  decideCheckoutRates(base, () => []),
  {
    kind: "empty",
    reason: "no-match",
  },
);

console.log("M2 checkout decision order passed.");
