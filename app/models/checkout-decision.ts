import type { MultipleRates, RoundingMethod } from "./shipping-settings";

export type CheckoutRate = {
  id: string;
  amountInMinorUnits: number;
  priority?: number;
};

export type CheckoutDecisionInput = {
  appEnabled: boolean;
  mode: "ccs-rates" | "delivery-customization" | null;
  testMode: boolean;
  customerFirstName?: string | null;
  multipleRates: MultipleRates;
  rounding: RoundingMethod;
  unitsPerMajor?: number;
  fallbackRate?: CheckoutRate | null;
};

export type EmptyCheckoutDecision = {
  kind: "empty";
  reason: "app-disabled" | "inactive-mode" | "test-mode" | "no-match";
};

export type RatesCheckoutDecision = {
  kind: "rates";
  source: "pricing" | "fallback";
  rates: CheckoutRate[];
};

export type CheckoutDecision = EmptyCheckoutDecision | RatesCheckoutDecision;

export function decideCheckoutRates(
  input: CheckoutDecisionInput,
  evaluatePricing: () => readonly CheckoutRate[],
): CheckoutDecision {
  const blocked = checkoutBlockReason(input);
  if (blocked) return { kind: "empty", reason: blocked };

  const pricedRates = evaluatePricing();
  if (pricedRates.length > 0) {
    return {
      kind: "rates",
      source: "pricing",
      rates: selectMultipleRates(pricedRates, input.multipleRates).map((rate) =>
        roundRate(rate, input.rounding, input.unitsPerMajor),
      ),
    };
  }

  const fallback = input.fallbackRate;
  if (fallback) {
    return {
      kind: "rates",
      source: "fallback",
      rates: [roundRate(fallback, input.rounding, input.unitsPerMajor)],
    };
  }

  return { kind: "empty", reason: "no-match" };
}

export function checkoutBlockReason(
  input: Pick<
    CheckoutDecisionInput,
    "appEnabled" | "mode" | "testMode" | "customerFirstName"
  >,
) {
  if (!input.appEnabled) return "app-disabled";
  if (input.mode !== "ccs-rates") return "inactive-mode";
  if (input.testMode && !isTestCheckout(input.customerFirstName))
    return "test-mode";
  return null;
}

export function isTestCheckout(customerFirstName?: string | null) {
  return customerFirstName?.trim().toLowerCase() === "shipflow";
}

export function selectMultipleRates(
  rates: readonly CheckoutRate[],
  behavior: MultipleRates,
): CheckoutRate[] {
  if (behavior === "all" || rates.length === 0) return [...rates];
  if (behavior === "priority") {
    return [
      rates.reduce((selected, rate) =>
        (rate.priority ?? Number.MAX_SAFE_INTEGER) <
        (selected.priority ?? Number.MAX_SAFE_INTEGER)
          ? rate
          : selected,
      ),
    ];
  }
  const compare =
    behavior === "highest"
      ? (selected: CheckoutRate, rate: CheckoutRate) =>
          rate.amountInMinorUnits > selected.amountInMinorUnits
      : (selected: CheckoutRate, rate: CheckoutRate) =>
          rate.amountInMinorUnits < selected.amountInMinorUnits;
  return [
    rates.reduce((selected, rate) =>
      compare(selected, rate) ? rate : selected,
    ),
  ];
}

export function roundAmount(
  amountInMinorUnits: number,
  method: RoundingMethod,
  unitsPerMajor = 100,
) {
  if (method === "none") return amountInMinorUnits;
  const increment =
    method === "nearest-half" ? Math.max(1, unitsPerMajor / 2) : unitsPerMajor;
  if (method === "ceil")
    return Math.ceil(amountInMinorUnits / increment) * increment;
  if (method === "floor")
    return Math.floor(amountInMinorUnits / increment) * increment;
  return Math.round(amountInMinorUnits / increment) * increment;
}

function roundRate(
  rate: CheckoutRate,
  method: RoundingMethod,
  unitsPerMajor?: number,
): CheckoutRate {
  return {
    ...rate,
    amountInMinorUnits: roundAmount(
      rate.amountInMinorUnits,
      method,
      unitsPerMajor,
    ),
  };
}
