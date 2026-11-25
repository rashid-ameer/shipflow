import {
  decideCheckoutRates,
  isTestCheckout,
  type CheckoutDecisionInput,
} from "./checkout-decision";

export const ratesPaths = {
  hub: "/app/rates",
  regions: "/app/rates/regions",
  scenarios: "/app/rates/scenarios",
  scenario: (id: string) => `/app/rates/scenarios/${id}`,
};

export type Coverage = { country: string; provinces: string[] };
export type Region = {
  id: string;
  name: string;
  kind: "DOMESTIC" | "CUSTOM" | "REST";
  coverage: Coverage[];
};
type Destination = { country: string; province: string | null };

export const conditionDefinitions = {
  cartTotal: { label: "Total", group: "Cart", kind: "money" },
  cartQuantity: { label: "Quantity", group: "Cart", kind: "number" },
  cartWeight: { label: "Weight", group: "Cart", kind: "weight" },
  postalCode: { label: "Postal code", group: "Cart", kind: "postal" },
  productTotal: { label: "Line total", group: "Product", kind: "money" },
  productPrice: { label: "Unit price", group: "Product", kind: "money" },
  productQuantity: { label: "Quantity", group: "Product", kind: "number" },
  productWeight: { label: "Weight", group: "Product", kind: "weight" },
  productName: { label: "Name", group: "Product", kind: "text" },
  productSku: { label: "SKU", group: "Product", kind: "text" },
  productVendor: { label: "Vendor", group: "Product", kind: "text" },
  country: { label: "Delivery country", group: "Customer", kind: "text" },
  province: { label: "Delivery province", group: "Customer", kind: "exact" },
  city: { label: "Delivery city", group: "Customer", kind: "text" },
  customerTag: {
    label: "Customer tag (when supplied by Shopify)",
    group: "Customer",
    kind: "text",
  },
} as const;
export const operatorLabels = {
  eq: "Equals",
  ne: "Does not equal",
  gt: "Greater than",
  gte: "At least",
  lt: "Less than",
  lte: "At most",
  between: "Between",
  contains: "Contains",
  notContains: "Does not contain",
  starts: "Starts with",
  notStarts: "Does not start with",
} as const;
type Operator = keyof typeof operatorLabels;
type ConditionField = keyof typeof conditionDefinitions;
export type ConditionDraft = {
  field: ConditionField;
  operator: Operator;
  value: string;
  upper?: string;
  scope?: "all" | "any" | "none";
  individual?: boolean;
};
type WeightUnit = "g" | "kg" | "lb" | "oz";
export type RateCondition = ConditionDraft & {
  currency?: string;
  weightUnit?: WeightUnit;
};
export type RateDraft = {
  id: string;
  regionId: string;
  name: string;
  description: string;
  price: string;
};
export type FixedRate = Omit<RateDraft, "price"> & {
  amount: number;
  currency: string;
};
export type ScenarioDraft = {
  name: string;
  active: boolean;
  conditions: ConditionDraft[];
  rates: RateDraft[];
};
export type Scenario = {
  id?: string;
  name?: string;
  active: boolean;
  conditions: RateCondition[];
  rates: FixedRate[];
};
export const rateIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const regionNames = new Intl.DisplayNames(["en"], {
  type: "region",
  fallback: "none",
});
export const countries = Array.from({ length: 676 }, (_, index) =>
  String.fromCharCode(65 + Math.floor(index / 26), 65 + (index % 26)),
)
  .flatMap((code) => {
    const label = regionNames.of(code);
    return label && code !== "ZZ" ? [{ code, label }] : [];
  })
  .sort((a, b) => a.label.localeCompare(b.label));
const countryCodes = new Set(countries.map(({ code }) => code));
const weightGrams = {
  g: 1,
  kg: 1000,
  lb: 453.59237,
  oz: 28.349523125,
} as const;

export function matchRegion(regions: Region[], destination: Destination) {
  let broad: Region | undefined;
  let narrowExists = false;
  for (const region of regions) {
    for (const { country, provinces } of region.coverage) {
      if (country !== destination.country) continue;
      if (provinces.length === 0) broad = region;
      else {
        narrowExists = true;
        if (destination.province && provinces.includes(destination.province))
          return region;
      }
    }
  }
  if (!destination.province && narrowExists) return undefined;
  return broad ?? regions.find(({ kind }) => kind === "REST");
}

export function validateCoverage(candidate: unknown): Coverage[] {
  if (
    !Array.isArray(candidate) ||
    candidate.length === 0 ||
    candidate.length > 250
  ) {
    throw new Error("Select at least one country.");
  }
  const coverage: Coverage[] = [];
  for (const value of candidate) {
    const country = textValue(value?.country).toUpperCase();
    if (
      !countryCodes.has(country) ||
      coverage.some((entry) => entry.country === country)
    ) {
      throw new Error("Select a different valid country for each entry.");
    }
    if (!Array.isArray(value.provinces) || value.provinces.length > 80)
      throw new Error("Enter valid province or state codes.");
    const provinces = [
      ...new Set<string>(
        value.provinces
          .map((item: unknown) => textValue(item).toUpperCase())
          .filter(Boolean),
      ),
    ];
    if (provinces.some((code) => !/^[A-Z0-9-]{1,8}$/.test(code))) {
      throw new Error("Enter province or state codes such as ON, QC or NY.");
    }
    coverage.push({ country, provinces });
  }
  return coverage;
}

export function coverageConflict(coverage: Coverage[], others: Region[]) {
  return others.find((region) =>
    region.coverage.some((saved) =>
      coverage.some(
        (next) =>
          next.country === saved.country &&
          ((next.provinces.length === 0 && saved.provinces.length === 0) ||
            next.provinces.some((province) =>
              saved.provinces.includes(province),
            )),
      ),
    ),
  );
}

export function allowedOperators(field: ConditionField): Operator[] {
  const { kind, group } = conditionDefinitions[field];
  if (kind === "postal" || kind === "exact") return ["eq", "ne"];
  if (kind === "text")
    return ["eq", "ne", "contains", "notContains", "starts", "notStarts"];
  return group === "Product"
    ? ["eq", "ne", "gte", "lte", "between"]
    : ["eq", "ne", "gt", "gte", "lt", "lte", "between"];
}

export function validateScenario(
  input: unknown,
  currency: string,
  unit: string,
  regionIds: string[],
) {
  const draft = input as Partial<ScenarioDraft> | null;
  const name = validName(draft?.name, "scenario");
  if (
    !draft ||
    typeof draft.active !== "boolean" ||
    !Array.isArray(draft.conditions) ||
    draft.conditions.length > 30 ||
    !Array.isArray(draft.rates) ||
    draft.rates.length > 100
  ) {
    throw new Error("A scenario can have up to 30 conditions and 100 rates.");
  }
  const conditions = draft.conditions.map((condition) =>
    validateRateCondition(condition, currency, unit),
  );
  const ids = new Set<string>();
  const rates = draft.rates.map((rate): FixedRate => {
    if (!rate || !regionIds.includes(rate.regionId))
      throw new Error("Choose a region that still exists.");
    if (!rateIdPattern.test(rate.id) || ids.has(rate.id))
      throw new Error("One of the rate entries is invalid.");
    ids.add(rate.id);
    const description = textValue(rate.description);
    if (description.length > 250)
      throw new Error("Use up to 250 characters in a rate description.");
    return {
      id: rate.id,
      regionId: rate.regionId,
      name: validName(rate.name, "shipping rate"),
      description,
      currency,
      amount: parseMoney(rate.price, currency),
    };
  });
  return { name, active: draft.active, conditions, rates };
}

export function validateRateCondition(
  input: ConditionDraft,
  currency: string,
  weight: string,
): RateCondition {
  if (
    !input ||
    !Object.hasOwn(conditionDefinitions, input.field) ||
    !allowedOperators(input.field).includes(input.operator)
  )
    throw new Error("Choose a supported condition and operator.");
  const { kind, group } = conditionDefinitions[input.field];
  const value = textValue(input.value);
  const upper = textValue(input.upper);
  if (!value || value.length > 500) throw new Error("Enter a condition value.");
  const isNumber = kind === "money" || kind === "number" || kind === "weight";
  if (!isNumber && textList(value).length === 0)
    throw new Error("Enter at least one condition value.");
  if (isNumber) {
    const parse = (v: string) =>
      kind === "money"
        ? parseMoney(v, currency)
        : parseDecimal(v, kind === "number" ? 0 : 3);
    const low = parse(value);
    if (input.operator === "between" && parse(upper) < low)
      throw new Error("The upper value must be at least the lower value.");
  }
  if (
    kind === "postal" &&
    textList(value).some(
      (item) =>
        !/^[A-Z0-9 _-]+\*?$|^\d{1,12}:\d{1,12}$/i.test(item) ||
        (item.includes(":") &&
          Number(item.split(":")[0]) > Number(item.split(":")[1])),
    )
  )
    throw new Error(
      "Enter postal codes, prefixes such as 1004*, or ranges such as 100400:100500.",
    );
  return {
    field: input.field,
    operator: input.operator,
    value,
    ...(input.operator === "between" ? { upper } : {}),
    ...(group === "Product"
      ? {
          scope:
            input.scope === "all" || input.scope === "none"
              ? input.scope
              : "any",
        }
      : {}),
    ...(input.field === "productWeight"
      ? { individual: input.individual === true }
      : {}),
    ...(kind === "money" ? { currency } : {}),
    ...(kind === "weight" ? { weightUnit: asWeightUnit(weight) } : {}),
  };
}

export function validName(value: unknown, label: string) {
  const name = textValue(value);
  if (!name || name.length > 120)
    throw new Error(`Enter a ${label} name of 1 to 120 characters.`);
  return name;
}

export function moneyDecimals(currency: string) {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

export function parseMoney(value: unknown, currency: string) {
  const decimals = moneyDecimals(currency);
  const amount = parseDecimal(textValue(value), decimals);
  const inMinorUnits = Math.round(amount * 10 ** decimals);
  if (inMinorUnits > 2_000_000_000) throw new Error("Enter a smaller amount.");
  return inMinorUnits;
}

function parseDecimal(value: string, decimals: number) {
  if (
    !/^\d+(?:\.\d+)?$/.test(value) ||
    (value.split(".")[1]?.length ?? 0) > decimals ||
    Number(value) > 1_000_000
  ) {
    throw new Error(
      `Enter a non-negative number up to 1,000,000${decimals > 0 ? ` with up to ${decimals} decimal places` : ""}.`,
    );
  }
  return Number(value);
}

export function formatRateAmount(value: number, currency: string) {
  const decimals = moneyDecimals(currency);
  return (value / 10 ** decimals).toFixed(decimals);
}

type Line = {
  variantId?: string;
  name?: string;
  sku?: string;
  vendor?: string;
  quantity: number;
  grams: number | null;
  price: number;
};
export type CarrierCart = {
  currency: string;
  destination: Destination;
  origin?: Destination;
  locale?: string;
  customerId?: string;
  postalCode?: string;
  city?: string;
  firstName: string | null;
  customerTags?: string[];
  subtotal: number;
  lines: Line[];
};

export function normalizeCarrierPayload(input: unknown): CarrierCart | null {
  if (!input || typeof input !== "object" || !("rate" in input)) return null;
  const rate = input.rate as Record<string, unknown> | null;
  if (!rate || typeof rate !== "object") return null;
  const currency = textValue(rate.currency).toUpperCase();
  const addr = rate.destination as Record<string, unknown> | null;
  const country = textValue(addr?.country).toUpperCase();
  const province = textValue(addr?.province).toUpperCase() || null;
  if (
    !/^[A-Z]{3}$/.test(currency) ||
    !countryCodes.has(country) ||
    (province && !/^[A-Z0-9-]{1,8}$/.test(province)) ||
    !Array.isArray(rate.items) ||
    rate.items.length === 0 ||
    rate.items.length > 1000
  )
    return null;
  const lines: Line[] = [];
  for (const item of rate.items) {
    if (!item || typeof item !== "object") return null;
    const quantity = nonnegativeInt(item.quantity);
    const price = nonnegativeInt(item.price);
    const grams = nonnegativeInt(item.grams);
    if (!quantity || price === null || !Number.isSafeInteger(quantity * price))
      return null;
    lines.push({
      variantId: positiveShopifyId(item.variant_id) ?? undefined,
      quantity,
      price,
      grams,
      name: optionalText(item.name),
      sku: optionalText(item.sku),
      vendor: optionalText(item.vendor),
    });
  }
  const totals = rate.order_totals as { subtotal_price?: unknown } | null;
  const subtotal =
    nonnegativeInt(totals?.subtotal_price) ??
    lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
  if (!Number.isSafeInteger(subtotal)) return null;
  const customer = rate.customer as { tags?: unknown } | null;
  const origin = rate.origin as Record<string, unknown> | null;
  const originCountry = textValue(origin?.country).toUpperCase();
  const originProvince = textValue(origin?.province).toUpperCase();
  const customerTags = Array.isArray(customer?.tags)
    ? customer.tags.filter((tag) => typeof tag === "string")
    : undefined;
  return {
    currency,
    destination: { country, province },
    origin: countryCodes.has(originCountry)
      ? {
          country: originCountry,
          province: /^[A-Z0-9-]{1,8}$/.test(originProvince)
            ? originProvince
            : null,
        }
      : undefined,
    locale: normalizeLocale(rate.locale),
    customerId:
      positiveShopifyId((rate.customer as { id?: unknown } | null)?.id) ??
      undefined,
    subtotal,
    lines,
    customerTags,
    postalCode: optionalText(addr?.postal_code) ?? optionalText(addr?.zip),
    city: optionalText(addr?.city),
    firstName:
      optionalText(addr?.first_name) ??
      optionalText(addr?.name)?.split(/\s+/)[0] ??
      null,
  };
}

export function positiveShopifyId(value: unknown) {
  const id =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : textValue(value);
  return /^[1-9][0-9]{0,19}$/.test(id) ? id : null;
}

export function normalizeLocale(value: unknown) {
  const locale = textValue(value);
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(locale)) return;
  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
}

export type ConditionOutcome = "matched" | "unmatched" | "missing" | "currency";
type ScenarioOutcome =
  "inactive" | "conditions" | "no-region-rate" | "currency" | "eligible";
export type PricingTrace = {
  region: { id: string; name: string } | null;
  scenarios: {
    id: string | null;
    name: string;
    outcome: ScenarioOutcome;
    conditions: {
      title: string;
      expected: string;
      outcome: ConditionOutcome;
    }[];
  }[];
  rates: {
    id: string;
    name: string;
    scenario: string;
    currency: string;
    amount: number;
    finalAmount: number | null;
  }[];
  selection: CheckoutDecisionInput["multipleRates"];
  rounding: CheckoutDecisionInput["rounding"];
};
export type PricingReason =
  | "matched"
  | "no-region"
  | "no-active-scenarios"
  | "unmatched-conditions"
  | "no-region-rate"
  | "currency-mismatch"
  | "app-disabled"
  | "inactive-mode"
  | "test-mode"
  | "carrier-disabled"
  | "invalid-request"
  | "evaluation-error"
  | "no-match";
export type PricingResult = {
  rates: {
    service_name: string;
    service_code: string;
    description: string;
    currency: string;
    total_price: string;
  }[];
  reason: PricingReason;
  trace: PricingTrace | null;
};

export function evaluateCarrierCart(
  cart: CarrierCart,
  settings: CheckoutDecisionInput,
  regions: Region[],
  scenarios: Scenario[],
): PricingResult {
  let region: Region | undefined;
  const quotes = new Map<string, FixedRate>();
  const trace: PricingTrace = {
    region: null,
    scenarios: [],
    rates: [],
    selection: settings.multipleRates,
    rounding: settings.rounding,
  };
  const outcomes = new Set<ScenarioOutcome>();
  let evaluated = false;
  const decision = decideCheckoutRates(
    {
      ...settings,
      customerFirstName: cart.firstName,
      unitsPerMajor: 10 ** moneyDecimals(cart.currency),
    },
    () => {
      evaluated = true;
      region = matchRegion(regions, cart.destination);
      if (!region) return [];
      trace.region = { id: region.id, name: region.name };
      let priority = 0;
      const regionId = region.id;
      return scenarios.flatMap((scenario) => {
        const name = scenario.name ?? "Scenario";
        const conditions = scenario.active
          ? scenario.conditions.map((condition) => ({
              title: `${conditionDefinitions[condition.field].group} · ${conditionDefinitions[condition.field].label}`,
              expected: conditionExpectation(condition),
              outcome: conditionOutcome(condition, cart),
            }))
          : [];
        const regionRates = scenario.rates.filter(
          (rate) => rate.regionId === regionId,
        );
        const eligible = regionRates.filter(
          (rate) => rate.currency === cart.currency,
        );
        const failed = conditions.filter(
          (condition) => condition.outcome !== "matched",
        );
        const outcome: ScenarioOutcome = !scenario.active
          ? "inactive"
          : failed.length
            ? failed.every((condition) => condition.outcome === "currency")
              ? "currency"
              : "conditions"
            : !regionRates.length
              ? "no-region-rate"
              : !eligible.length
                ? "currency"
                : "eligible";
        outcomes.add(outcome);
        trace.scenarios.push({
          id: scenario.id ?? null,
          name,
          outcome,
          conditions,
        });
        if (outcome !== "eligible") return [];
        return eligible.map((rate) => {
          quotes.set(rate.id, rate);
          trace.rates.push({
            id: rate.id,
            name: rate.name,
            scenario: name,
            currency: rate.currency,
            amount: rate.amount,
            finalAmount: null,
          });
          return {
            id: rate.id,
            amountInMinorUnits: rate.amount,
            priority: priority++,
          };
        });
      });
    },
  );
  if (!evaluated && decision.kind === "empty")
    return { rates: [], reason: decision.reason, trace: null };
  if (decision.kind === "empty") {
    const reason = !region
      ? "no-region"
      : outcomes.has("currency")
        ? "currency-mismatch"
        : outcomes.has("no-region-rate")
          ? "no-region-rate"
          : outcomes.has("conditions")
            ? "unmatched-conditions"
            : "no-active-scenarios";
    return { rates: [], reason, trace };
  }
  const finalAmounts = new Map(
    decision.rates.map((rate) => [rate.id, rate.amountInMinorUnits]),
  );
  for (const rate of trace.rates)
    rate.finalAmount = finalAmounts.get(rate.id) ?? null;
  const rates = decision.rates.flatMap((rate) => {
    const quote = quotes.get(rate.id);
    if (!quote) return [];
    const amount =
      moneyDecimals(quote.currency) === 0
        ? rate.amountInMinorUnits * 100
        : rate.amountInMinorUnits;
    return [
      {
        service_name: quote.name,
        service_code: `shipflow-${quote.id}`,
        description: quote.description,
        currency: quote.currency,
        total_price: String(amount),
      },
    ];
  });
  return { rates, reason: rates.length ? "matched" : "no-match", trace };
}

function conditionExpectation(condition: RateCondition) {
  const units = condition.currency ?? condition.weightUnit;
  return [
    operatorLabels[condition.operator],
    condition.value,
    condition.upper ? `and ${condition.upper}` : "",
    units ?? "",
    condition.scope ? `(${condition.scope} items)` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function conditionOutcome(
  condition: RateCondition,
  cart: CarrierCart,
): ConditionOutcome {
  const { field } = condition;
  const { kind } = conditionDefinitions[field];
  if (kind === "money" && condition.currency !== cart.currency)
    return "currency";
  if (
    (field === "postalCode" && !cart.postalCode) ||
    (field === "province" && !cart.destination.province) ||
    (field === "city" && !cart.city) ||
    (field === "customerTag" && cart.customerTags === undefined) ||
    (field === "cartWeight" && cart.lines.some((line) => line.grams === null))
  )
    return "missing";
  if (matchesCondition(condition, cart)) return "matched";
  if (
    (field === "productName" &&
      cart.lines.some((line) => line.name === undefined)) ||
    (field === "productSku" &&
      cart.lines.some((line) => line.sku === undefined)) ||
    (field === "productVendor" &&
      cart.lines.some((line) => line.vendor === undefined)) ||
    (field === "productWeight" &&
      cart.lines.some((line) => line.grams === null))
  )
    return "missing";
  return "unmatched";
}

export function testIdentity(cart: CarrierCart) {
  return !cart.firstName
    ? "missing"
    : isTestCheckout(cart.firstName)
      ? "test"
      : "other";
}

function matchesCondition(condition: RateCondition, cart: CarrierCart) {
  const { field, operator, value, upper } = condition;
  const { kind, group } = conditionDefinitions[field];
  if (kind === "money" && condition.currency !== cart.currency) return false;
  const low =
    kind === "money" ? parseMoney(value, cart.currency) : Number(value);
  const high =
    upper === undefined
      ? undefined
      : kind === "money"
        ? parseMoney(upper, cart.currency)
        : Number(upper);
  const compareNumber = (actual: number) =>
    compareNumeric(actual, operator, low, high);
  const factor = weightGrams[asWeightUnit(condition.weightUnit)];
  if (field === "cartTotal") return compareNumber(cart.subtotal);
  if (field === "cartQuantity")
    return compareNumber(
      cart.lines.reduce((sum, line) => sum + line.quantity, 0),
    );
  if (field === "cartWeight")
    return (
      cart.lines.every((line) => line.grams !== null) &&
      compareNumber(
        cart.lines.reduce((sum, line) => sum + line.grams! * line.quantity, 0) /
          factor,
      )
    );
  if (field === "postalCode")
    return (
      Boolean(cart.postalCode) &&
      compareText([cart.postalCode!], operator, textList(value), postalMatch)
    );
  if (field === "country")
    return compareText([cart.destination.country], operator, textList(value));
  if (field === "province")
    return (
      Boolean(cart.destination.province) &&
      compareText([cart.destination.province!], operator, textList(value))
    );
  if (field === "city")
    return (
      Boolean(cart.city) && compareText([cart.city!], operator, textList(value))
    );
  if (field === "customerTag")
    return (
      cart.customerTags !== undefined &&
      compareText(cart.customerTags, operator, textList(value))
    );
  if (group !== "Product") return false;
  const results = cart.lines.map((line): boolean | null => {
    switch (field) {
      case "productTotal":
        return compareNumber(line.price * line.quantity);
      case "productPrice":
        return compareNumber(line.price);
      case "productQuantity":
        return compareNumber(line.quantity);
      case "productWeight":
        return line.grams === null
          ? null
          : compareNumber(
              (line.grams * (condition.individual ? 1 : line.quantity)) /
                factor,
            );
      case "productName":
        return line.name === undefined
          ? null
          : compareText([line.name], operator, textList(value));
      case "productSku":
        return line.sku === undefined
          ? null
          : compareText([line.sku], operator, textList(value));
      case "productVendor":
        return line.vendor === undefined
          ? null
          : compareText([line.vendor], operator, textList(value));
      default:
        return null;
    }
  });
  if (condition.scope === "none")
    return results.every((result) => result === false);
  if (condition.scope === "all")
    return results.every((result) => result === true);
  return results.some((result) => result === true);
}

function compareNumeric(
  actual: number,
  operator: Operator,
  low: number,
  high?: number,
) {
  switch (operator) {
    case "eq":
      return actual === low;
    case "ne":
      return actual !== low;
    case "gt":
      return actual > low;
    case "gte":
      return actual >= low;
    case "lt":
      return actual < low;
    case "lte":
      return actual <= low;
    case "between":
      return high !== undefined && low <= actual && actual <= high;
    default:
      return false;
  }
}

function compareText(
  actual: string[],
  operator: Operator,
  expected: string[],
  equals = (a: string, b: string) => a === b,
) {
  const matches = actual.some((item) =>
    expected.some((value) => {
      const a = item.toUpperCase(),
        b = value.toUpperCase();
      if (operator === "contains" || operator === "notContains")
        return a.includes(b);
      if (operator === "starts" || operator === "notStarts")
        return a.startsWith(b);
      return equals(a, b);
    }),
  );
  return operator === "ne" ||
    operator === "notContains" ||
    operator === "notStarts"
    ? !matches
    : matches;
}

function postalMatch(actual: string, expected: string) {
  if (expected.includes(":")) {
    const [min, max] = expected.split(":").map(Number);
    return (
      /^\d+$/.test(actual) && min <= Number(actual) && Number(actual) <= max
    );
  }
  if (expected.endsWith("_"))
    return actual.startsWith(expected.slice(0, -1) + " ");
  return expected.endsWith("*")
    ? actual.startsWith(expected.slice(0, -1))
    : actual === expected;
}

function nonnegativeInt(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
function asWeightUnit(value: unknown): WeightUnit {
  return typeof value === "string" && Object.hasOwn(weightGrams, value)
    ? (value as WeightUnit)
    : "kg";
}
function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function optionalText(value: unknown) {
  return textValue(value) || undefined;
}
function textList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
