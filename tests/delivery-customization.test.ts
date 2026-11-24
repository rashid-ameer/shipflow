import assert from "node:assert/strict";
import {
  emptyDeliveryRule,
  validateDeliveryRule,
  type DeliveryRule,
} from "../app/models/delivery-customization";
import {
  deliveryOperations,
  type DeliveryFunctionInput,
} from "../app/models/delivery-customization-runtime";

const methods: DeliveryFunctionInput["cart"]["deliveryGroups"][number]["deliveryOptions"] =
  [
    {
      handle: "standard",
      title: "Standard",
      deliveryMethodType: "SHIPPING",
      cost: { amount: "8.00" },
    },
    {
      handle: "express",
      title: "Express",
      deliveryMethodType: "SHIPPING",
      cost: { amount: "15.00" },
    },
    {
      handle: "economy",
      title: "Economy",
      deliveryMethodType: "SHIPPING",
      cost: { amount: "5.00" },
    },
    {
      handle: "pickup",
      title: "Pickup",
      deliveryMethodType: "PICK_UP",
      cost: { amount: "0.00" },
    },
  ];
const rule: DeliveryRule = {
  ...emptyDeliveryRule("lb"),
  name: "Conditional delivery options",
  conditions: [
    { field: "weight", operator: "between", value: "2", upper: "3" },
    { field: "zip", operator: "starts-with", value: "M" },
  ],
  ifActions: [
    { kind: "bottom", operator: "equals", match: "Standard" },
    { kind: "reorder", operator: "equals", match: "Economy", position: 0 },
    { kind: "highest" },
  ],
  elseActions: [
    { kind: "hide-specific", operator: "contains", match: "express" },
    { kind: "show-all" },
  ],
};
const input: DeliveryFunctionInput = {
  deliveryCustomization: {},
  cart: {
    lines: [
      {
        quantity: 2,
        merchandise: {
          __typename: "ProductVariant",
          weight: 1,
          weightUnit: "POUNDS",
        },
      },
    ],
    deliveryGroups: [
      { deliveryAddress: { zip: "M5V" }, deliveryOptions: methods },
      {
        deliveryAddress: { zip: "H3B" },
        deliveryOptions: methods.map((item) => ({
          ...item,
          handle: `second-${item.handle}`,
        })),
      },
    ],
  },
};
function evaluate(next: DeliveryRule) {
  return deliveryOperations({
    ...input,
    deliveryCustomization: {
      metafield: { jsonValue: { version: 1, rule: next } },
    },
  }).operations;
}
assert.equal(validateDeliveryRule(rule).ok, true);
assert.equal(validateDeliveryRule({ ...rule, scope: "advanced" }).ok, false);
assert.equal(validateDeliveryRule({ ...rule, ifActions: [] }).ok, false);
assert.equal(validateDeliveryRule({ ...rule, methods: [] }).ok, false);
assert.equal(
  validateDeliveryRule({
    ...rule,
    methods: ["PICK_UP"],
    ifActions: [
      { kind: "rename", match: "Pickup", operator: "equals", text: "New" },
    ],
  }).ok,
  false,
);
assert.equal(
  validateDeliveryRule({
    ...rule,
    conditions: [
      { field: "weight", operator: "between", value: "3", upper: "1" },
    ],
  }).ok,
  false,
);
assert.deepEqual(deliveryOperations(input).operations, []);
assert.deepEqual(evaluate({ ...rule, active: false }), []);
assert.deepEqual(evaluate(rule), [
  { deliveryOptionMove: { deliveryOptionHandle: "standard", index: 3 } },
  { deliveryOptionMove: { deliveryOptionHandle: "economy", index: 0 } },
  { deliveryOptionHide: { deliveryOptionHandle: "standard" } },
  { deliveryOptionHide: { deliveryOptionHandle: "economy" } },
]);
assert.deepEqual(
  evaluate({
    ...rule,
    ifActions: [
      { kind: "show-specific", operator: "equals", match: "Standard" },
    ],
  }),
  ["express", "economy"].map((handle) => ({
    deliveryOptionHide: { deliveryOptionHandle: handle },
  })),
);
console.log(
  "M3 rule validation, per-group branching and scoped delivery operations passed.",
);
