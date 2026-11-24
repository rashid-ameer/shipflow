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
  if (!input.appEnabled) return { kind: "empty", reason: "app-disabled" };
  if (input.mode !== "ccs-rates") {
    return { kind: "empty", reason: "inactive-mode" };
  }
  if (input.testMode && !isTestCheckout(input.customerFirstName)) {
    return { kind: "empty", reason: "test-mode" };
  }

  const pricedRates = evaluatePricing();
  if (pricedRates.length > 0) {
    return {
      kind: "rates",
      source: "pricing",
      rates: selectMultipleRates(pricedRates, input.multipleRates).map((rate) =>
        roundRate(rate, input.rounding),
      ),
    };
  }

  if (input.fallbackRate) {
    return {
      kind: "rates",
      source: "fallback",
      rates: [roundRate(input.fallbackRate, input.rounding)],
    };
  }

  return { kind: "empty", reason: "no-match" };
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
) {
  if (method === "none") return amountInMinorUnits;
  const increment = method === "nearest-half" ? 50 : 100;
  if (method === "ceil")
    return Math.ceil(amountInMinorUnits / increment) * increment;
  if (method === "floor")
    return Math.floor(amountInMinorUnits / increment) * increment;
  return Math.round(amountInMinorUnits / increment) * increment;
}

function roundRate(rate: CheckoutRate, method: RoundingMethod): CheckoutRate {
  return {
    ...rate,
    amountInMinorUnits: roundAmount(rate.amountInMinorUnits, method),
  };
}
