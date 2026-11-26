import type { CarrierCart, FixedRate } from "./calculated-rates";
import { roundAmount } from "./checkout-decision";
import {
  asWeightUnit,
  compareText,
  formatRateAmount,
  moneyDecimals,
  parseDecimal,
  parseMoney,
  textList,
  textOperators,
  textValue,
  weightGrams,
  type TextOperator,
  type WeightUnit,
} from "./checkout-values";
import { ROUNDING_METHODS, type RoundingMethod } from "./shipping-settings";

import {
  packByAttributes,
  packByDimensions,
  validatePacking,
  type PackagePricing,
} from "./package-pricing";
import { dimensionalFactor, totalVolume } from "./product-dimensions";

export const pricingBases = {
  total: "Total",
  quantity: "Quantity",
  weight: "Weight",
  price: "Unit price",
  volume: "Volume",
  volumetric: "Volumetric weight",
} as const;
export const productFields = {
  tags: "Tag",
  sku: "SKU",
  barcode: "Barcode",
  vendor: "Vendor",
  productType: "Product type",
  collections: "Collection",
} as const;

type Line = CarrierCart["lines"][number];
type Basis = keyof typeof pricingBases;
export type ProductField = keyof typeof productFields;
export type ProductFilter = {
  field: ProductField;
  operator: TextOperator;
  value: string;
};
export type Modifier = {
  kind: "fixed" | "percent";
  value: string;
  basis: "shipping" | "cart";
};
export type Tier = { min: string; max: string; value: string };
export type RatePricing = {
  mode: "flat" | "tiered" | "incremental" | "package";
  packing?: PackagePricing;
  criteria: "cart" | "product";
  basis: Basis;
  amountType: "fixed" | "percent";
  weightUnit?: WeightUnit;
  tiers?: Tier[];
  increment?: {
    base: string;
    rate: string;
    step: string;
    skip: string;
    rounding: RoundingMethod;
  };
  filter?: ProductFilter;
  aggregate?: "line" | "combine" | "group";
  individual?: boolean;
  discount?: Modifier & { minimum?: string; minimumBasis?: Modifier["basis"] };
  handling?: Modifier;
  insurance?: Modifier;
  minimum?: string;
  maximum?: string;
};

export function validateProductFilter(input: ProductFilter): ProductFilter {
  if (
    !input ||
    !Object.hasOwn(productFields, input.field) ||
    !textOperators.includes(input.operator)
  )
    throw new Error("Choose a supported product filter and operator.");
  const value = textValue(input.value);
  if (!textList(value).length || value.length > 500)
    throw new Error("Enter product filter values, up to 500 characters.");
  return { field: input.field, operator: input.operator, value };
}

export function productValues(line: Line, field: ProductField) {
  const value = line[field];
  return typeof value === "string" ? (value ? [value] : []) : value;
}

export function productMatches(line: Line, filter: ProductFilter) {
  const actual = productValues(line, filter.field);
  return actual === undefined
    ? null
    : compareText(actual, filter.operator, textList(filter.value));
}

function readBasis(value: string, basis: Basis, currency: string) {
  return basis === "total" || basis === "price"
    ? parseMoney(value, currency)
    : parseDecimal(textValue(value), basis === "quantity" ? 0 : 3);
}

function readAmount(
  value: string,
  kind: "fixed" | "percent",
  currency: string,
) {
  return kind === "fixed"
    ? parseMoney(value, currency)
    : parseDecimal(textValue(value), 3);
}

function validateModifier(modifier: Modifier, currency: string): Modifier {
  if (modifier.kind !== "fixed" && modifier.kind !== "percent")
    throw new Error("Choose a fixed or percentage modifier.");
  if (modifier.basis !== "shipping" && modifier.basis !== "cart")
    throw new Error("Choose a basis for the modifier.");
  readAmount(modifier.value, modifier.kind, currency);
  return {
    kind: modifier.kind,
    basis: modifier.basis,
    value: textValue(modifier.value),
  };
}

export function validateRatePricing(
  input: RatePricing,
  currency: string,
  defaultWeightUnit: string,
  defaultDimensionUnit = "cm",
): RatePricing {
  if (
    !input ||
    !["flat", "tiered", "incremental", "package"].includes(input.mode) ||
    !["cart", "product"].includes(input.criteria) ||
    !Object.hasOwn(pricingBases, input.basis) ||
    (input.criteria === "cart" && input.basis === "price") ||
    !["fixed", "percent"].includes(input.amountType)
  )
    throw new Error("Choose a supported pricing method and basis.");
  const { mode, criteria, basis, amountType } = input;
  const result: RatePricing =
    mode === "flat"
      ? { mode, criteria: "cart", basis: "total", amountType: "fixed" }
      : { mode, criteria, basis, amountType };
  if (mode === "package") {
    result.criteria = "cart";
    result.basis = "total";
    result.packing = validatePacking(
      input.packing,
      currency,
      amountType,
      defaultWeightUnit,
      defaultDimensionUnit,
    );
    if (input.filter) result.filter = validateProductFilter(input.filter);
  }
  if (mode !== "flat" && mode !== "package" && basis === "weight")
    result.weightUnit = asWeightUnit(input.weightUnit ?? defaultWeightUnit);
  if (mode === "tiered") {
    if (
      !Array.isArray(input.tiers) ||
      !input.tiers.length ||
      input.tiers.length > 30
    )
      throw new Error("Add between 1 and 30 tiers.");
    result.tiers = input.tiers.map((tier, index) => {
      if (!tier || typeof tier.max !== "string")
        throw new Error(`Enter a maximum or ~ for tier ${index + 1}.`);
      const min = readBasis(tier.min, basis, currency);
      const maxText = tier.max.trim();
      const max =
        maxText === "~" || maxText === ""
          ? Infinity
          : readBasis(maxText, basis, currency);
      if (max < min)
        throw new Error(
          `The maximum for tier ${index + 1} must be at least its minimum.`,
        );
      readAmount(tier.value, amountType, currency);
      return {
        min: textValue(tier.min),
        max: maxText || "~",
        value: textValue(tier.value),
      };
    });
  }
  if (mode === "incremental") {
    const increment = input.increment;
    if (!increment || !ROUNDING_METHODS.includes(increment.rounding))
      throw new Error("Choose increment settings.");
    readAmount(increment.base, amountType, currency);
    readAmount(increment.rate, amountType, currency);
    if (readBasis(increment.step, basis, currency) <= 0)
      throw new Error("The increment step must be greater than zero.");
    if (textValue(increment.skip)) readBasis(increment.skip, basis, currency);
    result.increment = {
      base: textValue(increment.base),
      rate: textValue(increment.rate),
      step: textValue(increment.step),
      skip: textValue(increment.skip) || "0",
      rounding: increment.rounding,
    };
  }
  if (criteria === "product" && (mode === "tiered" || mode === "incremental")) {
    if (input.filter) result.filter = validateProductFilter(input.filter);
    if (input.aggregate === "group" && !result.filter)
      throw new Error("Choose a product filter before grouping.");
    if (input.aggregate === "group" || input.aggregate === "combine")
      result.aggregate = input.aggregate;
    if (["weight", "volume", "volumetric"].includes(basis) && input.individual)
      result.individual = true;
  }
  for (const key of ["minimum", "maximum"] as const) {
    const value = textValue(input[key]);
    if (value) {
      parseMoney(value, currency);
      result[key] = value;
    }
  }
  if (
    result.minimum &&
    result.maximum &&
    parseMoney(result.minimum, currency) > parseMoney(result.maximum, currency)
  )
    throw new Error("The maximum rate must be at least the minimum.");
  for (const key of ["handling", "insurance"] as const)
    if (input[key]) result[key] = validateModifier(input[key], currency);
  if (input.discount) {
    const minimum = textValue(input.discount.minimum);
    const discount = validateModifier(input.discount, currency);
    if (minimum) {
      const minimumBasis = input.discount.minimumBasis;
      if (minimumBasis !== "cart" && minimumBasis !== "shipping")
        throw new Error("Choose a basis for the discount minimum.");
      parseMoney(minimum, currency);
      result.discount = { ...discount, minimum, minimumBasis };
    } else result.discount = discount;
  }
  return result;
}

export type PriceStep = { label: string; amount: number; detail?: string };
export type IneligibleRate =
  | "inactive"
  | "no-products"
  | "missing-input"
  | "no-package"
  | "no-tier"
  | "carrier-unavailable"
  | "amount-limit";
export type RateQuote =
  | { amount: number; steps: PriceStep[] }
  | { reason: IneligibleRate; detail?: string };

function scaleAmount(
  amount: number,
  kind: "fixed" | "percent",
  subtotal: number,
) {
  return kind === "fixed" ? amount : subtotal * (amount / 100);
}

function formatBasis(amount: number, pricing: RatePricing, currency: string) {
  if (pricing.basis === "total" || pricing.basis === "price")
    return `${formatRateAmount(amount, currency)} ${currency}`;
  const value = new Intl.NumberFormat("en", {
    maximumFractionDigits: 3,
  }).format(amount);
  return `${value} ${pricing.basis === "weight" ? (pricing.weightUnit ?? "kg") : pricing.basis === "volume" ? "cm³" : pricing.basis === "volumetric" ? "kg" : "items"}`;
}

function productGroups(
  pricing: RatePricing,
  cart: CarrierCart,
): { lines: Line[]; label?: string }[] | IneligibleRate {
  let lines = cart.lines;
  const filter = pricing.filter;
  if (filter) {
    const matches = lines.map((line) => productMatches(line, filter));
    if (matches.includes(null)) return "missing-input";
    lines = lines.filter((_, index) => matches[index]);
  }
  if (!lines.length) return "no-products";
  if (pricing.aggregate === "combine") return [{ lines }];
  if (pricing.aggregate !== "group" || !filter)
    return lines.map((line) => ({ lines: [line], label: line.name }));
  const groups = new Map<string, Line[]>();
  for (const line of lines) {
    const matches = productValues(line, filter.field)!;
    const values = matches.filter((value) =>
      compareText([value], filter.operator, textList(filter.value)),
    );
    for (const value of new Set(
      (values.length ? values : [""]).map((value) => value.toUpperCase()),
    )) {
      const group = groups.get(value) ?? [];
      group.push(line);
      groups.set(value, group);
    }
  }
  return [...groups.entries()].map(([label, lines]) => ({
    lines,
    label: label || undefined,
  }));
}

function measure(
  pricing: RatePricing,
  lines: Line[],
  subtotal: number,
  divisor?: number,
) {
  switch (pricing.basis) {
    case "price":
      return lines.reduce((sum, line) => sum + line.price, 0);
    case "total":
      return subtotal;
    case "quantity":
      return lines.reduce((sum, line) => sum + line.quantity, 0);
    case "volume":
    case "volumetric": {
      const volume = totalVolume(lines, pricing.individual);
      return volume === undefined
        ? null
        : pricing.basis === "volume"
          ? volume
          : volume / dimensionalFactor(divisor);
    }
    case "weight":
      if (lines.some((line) => line.grams === null)) return null;
      return (
        lines.reduce(
          (sum, line) =>
            sum + (line.grams ?? 0) * (pricing.individual ? 1 : line.quantity),
          0,
        ) / weightGrams[pricing.weightUnit ?? "kg"]
      );
  }
}

export function quoteRate(
  rate: FixedRate,
  cart: CarrierCart,
  base?: PriceStep,
): RateQuote {
  const pricing = rate.pricing;
  if (rate.active === false) return { reason: "inactive" };
  let amount = rate.amount;
  const currency = cart.currency;
  const steps: PriceStep[] = [];
  if (base) {
    amount = base.amount;
    steps.push(base);
    if (rate.liveCarrier?.override) {
      amount = parseMoney(rate.liveCarrier.override, currency);
      steps.push({ label: "Shipping rate override", amount });
    }
  } else if (pricing?.mode === "package") {
    const packing = pricing.packing!;
    const filtered = productGroups({ ...pricing, aggregate: "combine" }, cart);
    if (typeof filtered === "string") return { reason: filtered };
    const [{ lines }] = filtered;
    const subtotal = pricing.filter
      ? lines.reduce((sum, line) => sum + line.price * line.quantity, 0)
      : cart.subtotal;
    const packed =
      packing.method === "attributes"
        ? packByAttributes(packing, lines, cart, subtotal)
        : packByDimensions(packing, lines);
    if ("reason" in packed) return packed;
    for (const { package: box, count, detail } of packed) {
      const price =
        Math.round(
          scaleAmount(
            readAmount(box.rate, pricing.amountType, currency),
            pricing.amountType,
            cart.subtotal,
          ),
        ) * count;
      steps.push({ label: `${box.name} × ${count}`, amount: price, detail });
    }
    amount = steps.reduce((sum, step) => sum + step.amount, 0);
  } else if (pricing && pricing.mode !== "flat") {
    const groups =
      pricing.criteria === "product"
        ? productGroups(pricing, cart)
        : [{ lines: cart.lines, label: undefined }];
    if (typeof groups === "string") return { reason: groups };
    const tiers = pricing.tiers?.map((tier) => ({
      min: readBasis(tier.min, pricing.basis, currency),
      max:
        tier.max === "~"
          ? Infinity
          : readBasis(tier.max, pricing.basis, currency),
      amount: readAmount(tier.value, pricing.amountType, currency),
    }));
    const increment = pricing.increment;
    const skip = increment
      ? readBasis(increment.skip, pricing.basis, currency)
      : 0;
    const size = increment
      ? readBasis(increment.step, pricing.basis, currency)
      : 0;
    const starting = increment
      ? readAmount(increment.base, pricing.amountType, currency)
      : 0;
    const extra = increment
      ? readAmount(increment.rate, pricing.amountType, currency)
      : 0;
    amount = 0;
    let remainingGroupAmount = 0;
    for (const [index, { lines, label }] of groups.entries()) {
      const subtotal =
        pricing.criteria === "cart"
          ? cart.subtotal
          : lines.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const value = measure(pricing, lines, subtotal, cart.volumetricDivisor);
      if (value === null)
        return { reason: "missing-input", detail: "Weight is unavailable." };
      const details = [
        label?.slice(0, 120),
        formatBasis(value, pricing, currency),
      ]
        .filter(Boolean)
        .join(" · ");
      let step: PriceStep;
      if (pricing.mode === "tiered") {
        const matched =
          tiers?.findIndex((tier) => tier.min <= value && value <= tier.max) ??
          -1;
        if (matched === -1) return { reason: "no-tier", detail: details };
        const price = Math.round(
          scaleAmount(tiers![matched].amount, pricing.amountType, subtotal),
        );
        step = {
          label: `Tier ${matched + 1}`,
          amount: price,
          detail:
            pricing.amountType === "percent"
              ? `${details} · ${tiers![matched].amount}% of ${formatRateAmount(subtotal, currency)} ${currency}`
              : details,
        };
      } else if (increment) {
        const base = scaleAmount(starting, pricing.amountType, subtotal);
        const stepsCharged = Math.max(0, value - skip) / size;
        const added = roundAmount(
          Math.round(
            scaleAmount(extra, pricing.amountType, subtotal) * stepsCharged,
          ),
          increment.rounding,
          10 ** moneyDecimals(currency),
        );
        const price = Math.round(base) + added;
        step = {
          label:
            groups.length > 1
              ? `Incremental price ${index + 1}`
              : "Incremental price",
          amount: price,
          detail: `${details} · ${formatRateAmount(Math.round(base), currency)} ${currency} base + ${formatRateAmount(added, currency)} ${currency} increment`,
        };
      } else return { reason: "no-tier", detail: details };
      amount += step.amount;
      if (!Number.isSafeInteger(amount)) return { reason: "amount-limit" };
      if (steps.length < 20) steps.push(step);
      else remainingGroupAmount += step.amount;
    }
    if (groups.length > 20)
      steps.push({
        label: `${groups.length - 20} additional groups`,
        amount: remainingGroupAmount,
      });
  } else steps.push({ label: "Fixed price", amount });

  if (pricing?.discount) {
    const { discount } = pricing;
    const minimum = discount.minimum
      ? parseMoney(discount.minimum, currency)
      : 0;
    if (
      (discount.minimumBasis === "cart" ? cart.subtotal : amount) >= minimum
    ) {
      amount = Math.max(0, amount - modifierAmount(discount, amount, cart));
      steps.push({ label: "After discount", amount });
    } else steps.push({ label: "Discount minimum not met", amount });
  }
  if (pricing) {
    const discounted = amount;
    for (const key of ["handling", "insurance"] as const) {
      const modifier = pricing[key];
      if (modifier) {
        amount += modifierAmount(modifier, discounted, cart);
        steps.push({
          label:
            key === "handling" ? "With handling fee" : "With insurance fee",
          amount,
        });
      }
    }
    const min = pricing.minimum ? parseMoney(pricing.minimum, currency) : 0;
    const max = pricing.maximum
      ? parseMoney(pricing.maximum, currency)
      : Infinity;
    if (!Number.isSafeInteger(amount)) return { reason: "amount-limit" };
    if (amount < min || amount > max) {
      const label = amount < min ? "Minimum applied" : "Maximum applied";
      amount = Math.max(min, Math.min(max, amount));
      steps.push({ label, amount });
    }
  }
  return Number.isSafeInteger(amount) && amount <= 2_000_000_000
    ? { amount, steps }
    : { reason: "amount-limit" };
}

function modifierAmount(
  modifier: Modifier,
  shipping: number,
  cart: CarrierCart,
) {
  return Math.round(
    scaleAmount(
      readAmount(modifier.value, modifier.kind, cart.currency),
      modifier.kind,
      modifier.basis === "shipping" ? shipping : cart.subtotal,
    ),
  );
}
