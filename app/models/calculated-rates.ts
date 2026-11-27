import {
  decideCheckoutRates,
  isTestCheckout,
  type CheckoutDecisionInput,
} from "./checkout-decision";
import {
  asWeightUnit,
  compareText,
  moneyDecimals,
  parseDecimal,
  parseMoney,
  textList,
  textOperators,
  textValue,
  weightGrams,
  type WeightUnit,
} from "./checkout-values";
import {
  productMatches,
  productValues,
  quoteRate,
  validateRatePricing,
  type IneligibleRate,
  type PriceStep,
  type ProductField,
  type RatePricing,
  type RateQuote,
} from "./rate-pricing";
export { formatRateAmount, moneyDecimals, parseMoney } from "./checkout-values";

import {
  combineShippingRates,
  type CombinedRule,
  type CombinationTrace,
} from "./combined-rates";

import {
  asDimensionUnit,
  displayDimension,
  dimensionalFactor,
  lineVolume,
  totalVolume,
  type DimensionAxis,
  type Dimensions,
} from "./product-dimensions";
import type { DimensionUnit } from "./shipping-settings";
import {
  defaultAppearance,
  deliveryDays,
  deliveryEstimate,
  distanceUnit,
  distanceUnits,
  validateRateCode,
  type Appearance,
  type DistanceUnit,
  type ShippingConfiguration,
} from "./checkout-settings";
import {
  validateLiveCarrierRate,
  type LiveCarrierRate,
  type CarrierQuoteResult,
} from "./live-carrier";

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
  cartDistance: { label: "Distance", group: "Cart", kind: "distance" },
  cartLength: { label: "Length", group: "Cart", kind: "dimension" },
  cartWidth: { label: "Width", group: "Cart", kind: "dimension" },
  cartHeight: { label: "Height", group: "Cart", kind: "dimension" },
  cartVolume: { label: "Volume", group: "Cart", kind: "volume" },
  cartVolumetric: {
    label: "Volumetric weight",
    group: "Cart",
    kind: "volumetric",
  },
  postalCode: { label: "Postal code", group: "Cart", kind: "postal" },
  productTotal: { label: "Line total", group: "Product", kind: "money" },
  productPrice: { label: "Unit price", group: "Product", kind: "money" },
  productQuantity: { label: "Quantity", group: "Product", kind: "number" },
  productWeight: { label: "Weight", group: "Product", kind: "weight" },
  productLength: { label: "Length", group: "Product", kind: "dimension" },
  productWidth: { label: "Width", group: "Product", kind: "dimension" },
  productHeight: { label: "Height", group: "Product", kind: "dimension" },
  productVolume: { label: "Volume", group: "Product", kind: "volume" },
  productVolumetric: {
    label: "Volumetric weight",
    group: "Product",
    kind: "volumetric",
  },
  productName: { label: "Name", group: "Product", kind: "text" },
  productSku: { label: "SKU", group: "Product", kind: "text" },
  productVendor: { label: "Vendor", group: "Product", kind: "text" },
  productTag: { label: "Tag", group: "Product", kind: "text" },
  productBarcode: { label: "Barcode", group: "Product", kind: "text" },
  productType: { label: "Product type", group: "Product", kind: "text" },
  productCollection: { label: "Collection", group: "Product", kind: "text" },
  country: { label: "Delivery country", group: "Customer", kind: "text" },
  province: { label: "Delivery province", group: "Customer", kind: "exact" },
  city: { label: "Delivery city", group: "Customer", kind: "text" },
  customerName: { label: "Name", group: "Customer", kind: "text" },
  customerEmail: { label: "Email", group: "Customer", kind: "text" },
  customerPhone: { label: "Phone", group: "Customer", kind: "text" },
  customerFax: { label: "Fax", group: "Customer", kind: "text" },
  customerAddress: { label: "Street address", group: "Customer", kind: "text" },
  customerCompany: { label: "Company", group: "Customer", kind: "text" },
  previousOrders: {
    label: "Previous order count",
    group: "Customer",
    kind: "number",
  },
  previousSpent: {
    label: "Previous order spent",
    group: "Customer",
    kind: "money",
  },
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
export const basicScopes = {
  any: "Any product",
  all: "All products",
  none: "None of the products",
} as const;
export const taggedScopes = {
  "tag-all": "All matching products have the tag",
  "tag-any": "Any matching product has the tag",
  "tag-filter": "All products with the tag match",
} as const;
export const skuScopes = {
  "sku-all": "All matching products have the SKU",
  "sku-any": "Any matching product has the SKU",
  "sku-prefix-all": "All matching SKUs start with the value",
  "sku-prefix-any": "Any matching SKU starts with the value",
  "sku-filter": "All products with the SKU match",
  "sku-prefix-filter": "All products with the SKU prefix match",
} as const;
export const advancedProductScopes = { ...taggedScopes, ...skuScopes };
export type ConditionDraft = {
  dimensionUnit?: DimensionUnit;
  weightUnit?: WeightUnit;
  distanceUnit?: DistanceUnit;
  field: ConditionField;
  operator: Operator;
  value: string;
  upper?: string;
  scope?: keyof typeof basicScopes | keyof typeof advancedProductScopes;
  scopeValue?: string;
  provinceCountry?: string;
  individual?: boolean;
};
export type RateCondition = ConditionDraft & {
  currency?: string;
};
export type RateDraft = {
  id: string;
  regionId: string;
  name: string;
  description: string;
  price: string;
  pricing?: RatePricing;
  liveCarrier?: LiveCarrierRate;
  serviceCode?: string | null;
  minDays?: string | number | null;
  maxDays?: string | number | null;
  active?: boolean;
  tags?: string;
  notes?: string;
};
export type FixedRate = Omit<
  RateDraft,
  "price" | "tags" | "minDays" | "maxDays"
> & {
  amount: number;
  currency: string;
  tags?: string[];
  minDays?: number | null;
  maxDays?: number | null;
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

export const regionCountries = [
  { code: "US", label: "United States" },
  { code: "CA", label: "Canada" },
  { code: "GB", label: "United Kingdom" },
  { code: "AU", label: "Australia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "NL", label: "Netherlands" },
  { code: "BE", label: "Belgium" },
  { code: "ES", label: "Spain" },
  { code: "IT", label: "Italy" },
  { code: "MX", label: "Mexico" },
  { code: "JP", label: "Japan" },
];

export const regionProvinces: Record<
  string,
  { code: string; label: string }[]
> = {
  US: [
    { code: "CA", label: "California" },
    { code: "NY", label: "New York" },
    { code: "TX", label: "Texas" },
    { code: "FL", label: "Florida" },
    { code: "WA", label: "Washington" },
  ],
  CA: [
    { code: "ON", label: "Ontario" },
    { code: "QC", label: "Quebec" },
    { code: "BC", label: "British Columbia" },
    { code: "AB", label: "Alberta" },
  ],
  AU: [
    { code: "NSW", label: "New South Wales" },
    { code: "VIC", label: "Victoria" },
    { code: "QLD", label: "Queensland" },
  ],
};

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
  if (kind === "text") return [...textOperators];
  return group !== "Cart"
    ? ["eq", "ne", "gte", "lte", "between"]
    : ["eq", "ne", "gt", "gte", "lt", "lte", "between"];
}

export function supportsAdvancedScope(field: ConditionField) {
  const { group, kind } = conditionDefinitions[field];
  return group === "Product" && (kind !== "text" || field === "productName");
}

export function validateScenario(
  input: unknown,
  currency: string,
  unit: string,
  regionIds: string[],
  dimensionUnit = "cm",
  distance = "km",
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
    validateRateCondition(condition, currency, unit, dimensionUnit, distance),
  );
  const ids = new Set<string>();
  const rates = draft.rates.map((rate): FixedRate => {
    if (!rate || !regionIds.includes(rate.regionId))
      throw new Error("Choose a region that still exists.");
    if (!rateIdPattern.test(rate.id) || ids.has(rate.id))
      throw new Error("One of the rate entries is invalid.");
    ids.add(rate.id);
    return validateRateDraft(rate, currency, unit, dimensionUnit, distance);
  });
  return { name, active: draft.active, conditions, rates };
}

export function validateRateDraft(
  rate: RateDraft,
  currency: string,
  unit: string,
  dimensionUnit = "cm",
  distance = "km",
): FixedRate {
  const description = textValue(rate.description);
  const tags = [...new Set(textList(textValue(rate.tags)))];
  const notes = textValue(rate.notes);
  if (description.length > 250)
    throw new Error("Use up to 250 characters in a rate description.");
  if (
    notes.length > 1000 ||
    tags.length > 30 ||
    tags.some((tag) => tag.length > 60)
  )
    throw new Error(
      "Use up to 1,000 characters in notes and 30 tags of up to 60 characters each.",
    );
  const liveCarrier = rate.liveCarrier
    ? validateLiveCarrierRate(rate.liveCarrier, currency, unit, dimensionUnit)
    : undefined;
  const pricing = rate.pricing
    ? validateRatePricing(
        liveCarrier
          ? {
              ...rate.pricing,
              mode: "flat",
              criteria: "cart",
              basis: "total",
              amountType: "fixed",
            }
          : rate.pricing,
        currency,
        unit,
        dimensionUnit,
        distance,
      )
    : undefined;
  const minDays = liveCarrier ? null : deliveryDays(rate.minDays);
  const maxDays = liveCarrier ? null : deliveryDays(rate.maxDays);
  if (minDays != null && maxDays != null && minDays > maxDays)
    throw new Error(
      "The maximum delivery estimate must be at least the minimum.",
    );
  return {
    id: rate.id,
    regionId: rate.regionId,
    name: validName(rate.name, "shipping rate"),
    description,
    currency,
    pricing,
    liveCarrier,
    serviceCode: validateRateCode(rate.serviceCode),
    minDays,
    maxDays,
    active: rate.active !== false,
    tags,
    notes,
    amount: liveCarrier
      ? 0
      : !pricing || pricing.mode === "flat"
        ? parseMoney(rate.price, currency)
        : 0,
  };
}

export function validateRateCondition(
  input: ConditionDraft,
  currency: string,
  weight: string,
  dimensionUnit = "cm",
  distance = "km",
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
  const isNumber = !["text", "exact", "postal"].includes(kind);
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
  const scope = input.scope ?? "any";
  const advanced = Object.hasOwn(advancedProductScopes, scope);
  const scopeValue = textValue(input.scopeValue);
  if (
    group === "Product" &&
    !Object.hasOwn(basicScopes, scope) &&
    (!advanced || !supportsAdvancedScope(input.field))
  )
    throw new Error("Choose a scope supported by this product condition.");
  if (
    group === "Product" &&
    advanced &&
    (!textList(scopeValue).length || scopeValue.length > 500)
  )
    throw new Error("Enter the tags or SKUs used by this scope.");
  const provinceCountry = textValue(input.provinceCountry).toUpperCase();
  if (
    input.field === "province" &&
    ((provinceCountry && !countryCodes.has(provinceCountry)) ||
      textList(value).some((code) => !/^[A-Z0-9-]{1,8}$/i.test(code)))
  )
    throw new Error(
      "Enter valid province or state codes and select their country.",
    );
  return {
    field: input.field,
    operator: input.operator,
    value,
    ...(input.operator === "between" ? { upper } : {}),
    ...(group === "Product"
      ? { scope, ...(advanced ? { scopeValue } : {}) }
      : {}),
    ...(input.field === "province" && provinceCountry
      ? { provinceCountry }
      : {}),
    ...(group === "Product" && ["weight", "volume", "volumetric"].includes(kind)
      ? { individual: input.individual === true }
      : {}),
    ...(kind === "money" ? { currency } : {}),
    ...(kind === "weight"
      ? { weightUnit: asWeightUnit(input.weightUnit ?? weight) }
      : {}),
    ...(kind === "distance"
      ? { distanceUnit: distanceUnit(input.distanceUnit ?? distance) }
      : {}),
    ...(kind === "dimension"
      ? { dimensionUnit: asDimensionUnit(input.dimensionUnit ?? dimensionUnit) }
      : {}),
  };
}

export function validName(value: unknown, label: string) {
  const name = textValue(value);
  if (!name || name.length > 120)
    throw new Error(`Enter a ${label} name of 1 to 120 characters.`);
  return name;
}

type Line = {
  variantId?: string;
  name?: string;
  sku?: string;
  vendor?: string;
  tags?: string[];
  barcode?: string;
  productType?: string;
  collections?: string[];
  dimensions?: Dimensions;
  quantity: number;
  grams: number | null;
  price: number;
};
export type CarrierCart = {
  currency: string;
  destination: Destination;
  origin?: Destination & {
    postalCode?: string;
    city?: string;
    street?: string;
  };
  distanceMeters?: number;
  distanceError?: string;
  ukPostal?: boolean;
  locale?: string;
  customerId?: string;
  postalCode?: string;
  city?: string;
  firstName: string | null;
  customerTags?: string[];
  customer?: {
    name?: string;
    email?: string;
    phone?: string;
    fax?: string;
    address?: string;
    company?: string;
    previousOrders?: number;
    previousSpent?: number;
    spentCurrency?: string;
  };
  subtotal: number;
  discountedSubtotal?: number;
  volumetricDivisor?: number;
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
      sku: typeof item.sku === "string" ? item.sku.trim() : undefined,
      vendor: typeof item.vendor === "string" ? item.vendor.trim() : undefined,
      barcode:
        typeof item.barcode === "string" ? item.barcode.trim() : undefined,
    });
  }
  const totals = rate.order_totals as {
    subtotal_price?: unknown;
    total_price?: unknown;
    discount_amount?: unknown;
  } | null;
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
          postalCode:
            optionalText(origin?.postal_code) ?? optionalText(origin?.zip),
          city: optionalText(origin?.city),
          street:
            [optionalText(origin?.address1), optionalText(origin?.address2)]
              .filter(Boolean)
              .join(" ") || undefined,
        }
      : undefined,
    locale: normalizeLocale(rate.locale),
    customerId:
      positiveShopifyId((rate.customer as { id?: unknown } | null)?.id) ??
      undefined,
    subtotal,
    discountedSubtotal:
      nonnegativeInt(totals?.total_price) ??
      (nonnegativeInt(totals?.discount_amount) === null
        ? undefined
        : Math.max(
            0,
            subtotal - (nonnegativeInt(totals?.discount_amount) ?? 0),
          )),
    lines,
    customerTags,
    postalCode: optionalText(addr?.postal_code) ?? optionalText(addr?.zip),
    city: optionalText(addr?.city),
    customer: {
      name: optionalText(addr?.name),
      email: optionalText(addr?.email),
      phone: optionalText(addr?.phone),
      fax: optionalText(addr?.fax),
      address:
        [optionalText(addr?.address1), optionalText(addr?.address2)]
          .filter(Boolean)
          .join(" ") || undefined,
      company: optionalText(addr?.company_name),
    },
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
  | "inactive"
  | "conditions"
  | "no-region-rate"
  | "currency"
  | "eligible"
  | "no-priced-rate";
export type PricingTrace = {
  distanceMeters?: number;
  distanceError?: string;
  pricingSubtotal?: number;
  pricingCurrency?: string;
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
    steps?: PriceStep[];
    tags?: string[];
    consumedBy?: string;
    deduplicated?: boolean;
    serviceCode?: string;
    deliveryEstimate?: string;
  }[];
  combinations?: CombinationTrace[];
  checkoutRateIds?: string[];
  rejectedRates?: {
    name: string;
    scenario: string;
    reason: IneligibleRate;
    detail?: string;
  }[];
  selection: CheckoutDecisionInput["multipleRates"];
  rounding: CheckoutDecisionInput["rounding"];
};
export type PricingReason =
  | "matched"
  | "store-fallback"
  | "no-region"
  | "no-active-scenarios"
  | "unmatched-conditions"
  | "no-region-rate"
  | "no-priced-rate"
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
    min_delivery_date?: string;
    max_delivery_date?: string;
  }[];
  reason: PricingReason;
  trace: PricingTrace | null;
};

function priceScenarioRate(
  rate: FixedRate,
  cart: CarrierCart,
  result?: CarrierQuoteResult,
): { options: { rate: FixedRate; price: RateQuote }[]; unavailable?: string } {
  const live = rate.liveCarrier;
  if (!live || rate.active === false)
    return { options: [{ rate, price: quoteRate(rate, cart) }] };
  if (result && "quotes" in result) {
    if (!result.quotes.length)
      return {
        options: [],
        unavailable: "No selected carrier services were returned.",
      };
    return {
      options: result.quotes.map(({ code, amount, name }) => {
        const option = {
          ...rate,
          id: `${rate.id}-${live.carrier}-${code}`,
          name,
          description: "",
          serviceCode: rate.serviceCode
            ? `${rate.serviceCode}:${live.carrier}:${code}`
            : undefined,
        };
        const price = quoteRate(option, cart, {
          label: "Carrier quote",
          amount,
          detail: result.detail,
        });
        return { rate: option, price };
      }),
    };
  }
  const detail = result?.error ?? "Live carrier quote is unavailable.";
  const fallback = live.fallback;
  if (!fallback) return { options: [], unavailable: detail };
  const option = {
    ...rate,
    id: `${rate.id}-carrier-fallback`,
    name: fallback.name,
    description: fallback.description,
    liveCarrier: { ...live, override: undefined },
    serviceCode: rate.serviceCode ? `${rate.serviceCode}:fallback` : undefined,
  };
  const amount =
    fallback.kind === "fixed"
      ? parseMoney(fallback.value, cart.currency)
      : Math.round((cart.subtotal * parseDecimal(fallback.value, 3)) / 100);
  const price = quoteRate(option, cart, {
    label: "Carrier fallback",
    amount,
    detail,
  });
  return {
    options: [
      { rate: option, price: "reason" in price ? { ...price, detail } : price },
    ],
  };
}

export function evaluateCarrierCart(
  cart: CarrierCart,
  settings: CheckoutDecisionInput,
  regions: Region[],
  scenarios: Scenario[],
  combinedRules: CombinedRule[] = [],
  liveQuotes: ReadonlyMap<string, CarrierQuoteResult> = new Map(),
  configuration: {
    shipping?: ShippingConfiguration;
    appearance?: Appearance;
    timezone?: string;
    now?: Date;
  } = {},
): PricingResult {
  let region: Region | undefined;
  const quotes = new Map<
    string,
    Pick<FixedRate, "name" | "description" | "currency"> & {
      minDays?: number | null;
      maxDays?: number | null;
      serviceCode?: string | null;
    }
  >();
  const trace: PricingTrace = {
    region: null,
    scenarios: [],
    rates: [],
    selection: settings.multipleRates,
    rounding: settings.rounding,
    ...(cart.distanceMeters !== undefined
      ? { distanceMeters: cart.distanceMeters }
      : {}),
    ...(cart.distanceError ? { distanceError: cart.distanceError } : {}),
  };
  const shipping = configuration.shipping;
  const fallback = shipping?.fallback;
  let fallbackBase = 0;
  const outcomes = new Set<ScenarioOutcome>();
  let evaluated = false;
  const decision = decideCheckoutRates(
    {
      ...settings,
      customerFirstName: cart.firstName,
      unitsPerMajor: 10 ** moneyDecimals(cart.currency),
      get fallbackRate() {
        if (!fallback) return null;
        const amount =
          fallback.kind === "percent"
            ? Math.round(
                (cart.subtotal * parseDecimal(fallback.value, 3)) / 100,
              )
            : fallback.currency === cart.currency
              ? parseMoney(fallback.value, cart.currency)
              : null;
        if (
          amount == null ||
          !Number.isSafeInteger(amount) ||
          amount > 2_000_000_000
        )
          return null;
        fallbackBase = amount;
        return { id: "store-fallback", amountInMinorUnits: amount };
      },
    },
    () => {
      evaluated = true;
      region = matchRegion(regions, cart.destination);
      if (!region) return [];
      trace.region = { id: region.id, name: region.name };
      let priority = 0;
      const flatSignatures = new Set<string>();
      const regionId = region.id;
      const pricedRates = scenarios.flatMap((scenario) => {
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
        const entry: PricingTrace["scenarios"][number] = {
          id: scenario.id ?? null,
          name,
          outcome,
          conditions,
        };
        trace.scenarios.push(entry);
        if (outcome !== "eligible") {
          outcomes.add(outcome);
          return [];
        }
        const priced = eligible.flatMap((rate) => {
          const { options, unavailable } = priceScenarioRate(
            rate,
            cart,
            liveQuotes.get(rate.id),
          );
          if (unavailable)
            (trace.rejectedRates ??= []).push({
              name: rate.name,
              scenario: name,
              reason: "carrier-unavailable",
              detail: unavailable,
            });
          return options.flatMap(({ rate, price }) => {
            if ("reason" in price) {
              (trace.rejectedRates ??= []).push({
                name: rate.name,
                scenario: name,
                ...price,
              });
              return [];
            }
            const signature =
              shipping?.preventDoubling &&
              !rate.liveCarrier &&
              (!rate.pricing || rate.pricing.mode === "flat")
                ? JSON.stringify([
                    rate.name.trim().toLowerCase(),
                    rate.description,
                    price.amount,
                    rate.minDays ?? null,
                    rate.maxDays ?? null,
                    shipping.manualCodes ? (rate.serviceCode ?? null) : null,
                    [
                      ...new Set(rate.tags?.map((tag) => tag.toLowerCase())),
                    ].sort(),
                  ])
                : null;
            const duplicate =
              signature != null && flatSignatures.has(signature);
            if (signature != null) flatSignatures.add(signature);
            trace.rates.push({
              id: rate.id,
              name: rate.name,
              scenario: name,
              currency: rate.currency,
              amount: price.amount,
              steps: price.steps,
              ...(rate.tags?.length ? { tags: rate.tags } : {}),
              finalAmount: null,
              ...(duplicate ? { deduplicated: true } : {}),
            });
            if (duplicate) return [];
            quotes.set(rate.id, rate);
            return [
              {
                id: rate.id,
                name: rate.name,
                tags: rate.tags ?? [],
                amountInMinorUnits: price.amount,
                priority: priority++,
              },
            ];
          });
        });
        if (!priced.length) entry.outcome = "no-priced-rate";
        outcomes.add(entry.outcome);
        return priced;
      });
      if (!combinedRules.length || !pricedRates.length) return pricedRates;
      const { steps, rates } = combineShippingRates(pricedRates, combinedRules);
      const ruleById = new Map(combinedRules.map((rule) => [rule.id, rule]));
      const traceById = new Map(trace.rates.map((rate) => [rate.id, rate]));
      trace.combinations = steps.map((step) => ({
        ...step,
        currency: cart.currency,
      }));
      for (const step of steps) {
        if (!("resultId" in step)) continue;
        const rule = ruleById.get(step.ruleId)!;
        quotes.set(step.resultId, {
          name: step.name,
          currency: cart.currency,
          description: rule.description,
          minDays: rule.minDays,
          maxDays: rule.maxDays,
          serviceCode: rule.serviceCode,
        });
        for (const source of step.sources) {
          const entry = traceById.get(source.id);
          if (entry) entry.consumedBy = step.name;
        }
        const entry: PricingTrace["rates"][number] = {
          id: step.resultId,
          name: step.name,
          scenario: "Combined rate",
          currency: cart.currency,
          amount: step.amount,
          finalAmount: null,
          ...(rule.outputTag ? { tags: [rule.outputTag] } : {}),
        };
        trace.rates.push(entry);
        traceById.set(entry.id, entry);
      }
      return rates;
    },
  );
  if (!evaluated && decision.kind === "empty")
    return { rates: [], reason: decision.reason, trace: null };
  if (decision.kind === "empty") {
    const reason = !region
      ? "no-region"
      : outcomes.has("no-priced-rate")
        ? "no-priced-rate"
        : outcomes.has("currency")
          ? "currency-mismatch"
          : outcomes.has("no-region-rate")
            ? "no-region-rate"
            : outcomes.has("conditions")
              ? "unmatched-conditions"
              : "no-active-scenarios";
    return { rates: [], reason, trace };
  }
  if (decision.source === "fallback" && fallback) {
    const { id } = decision.rates[0];
    quotes.set(id, {
      name: fallback.name,
      description: fallback.description,
      currency: cart.currency,
    });
    trace.rates.push({
      id,
      name: fallback.name,
      scenario: "Store fallback",
      currency: cart.currency,
      amount: fallbackBase,
      finalAmount: null,
      steps: [
        {
          label: "Store fallback",
          amount: fallbackBase,
          detail: "No scenario returned a rate.",
        },
      ],
    });
  }
  const finalAmounts = new Map(
    decision.rates.map((rate) => [rate.id, rate.amountInMinorUnits]),
  );
  if (trace.combinations?.length)
    trace.checkoutRateIds = decision.rates.map((rate) => rate.id);
  for (const rate of trace.rates) {
    rate.finalAmount = finalAmounts.get(rate.id) ?? null;
    if (rate.finalAmount !== null && settings.rounding !== "none")
      rate.steps?.push({
        label: "Settings rounding",
        amount: rate.finalAmount,
      });
  }
  const now = configuration.now ?? new Date();
  const rateDiagnostics = new Map(trace.rates.map((rate) => [rate.id, rate]));
  const rates = decision.rates.flatMap((rate) => {
    const quote = quotes.get(rate.id);
    if (!quote) return [];
    const estimate = deliveryEstimate(
      quote.minDays,
      quote.maxDays,
      configuration.appearance ?? defaultAppearance,
      configuration.timezone ?? "UTC",
      now,
    );
    const serviceCode =
      shipping?.manualCodes && quote.serviceCode
        ? quote.serviceCode
        : `shipflow-${rate.id}`;
    const diagnostics = rateDiagnostics.get(rate.id);
    if (diagnostics) {
      diagnostics.serviceCode = serviceCode;
      if (estimate) diagnostics.deliveryEstimate = estimate.text;
    }
    const amount =
      moneyDecimals(quote.currency) === 0
        ? rate.amountInMinorUnits * 100
        : rate.amountInMinorUnits;
    return [
      {
        service_name: quote.name,
        service_code: serviceCode,
        description: [quote.description, estimate?.text]
          .filter(Boolean)
          .join(" · "),
        currency: quote.currency,
        total_price: String(amount),
        ...(estimate?.min ? { min_delivery_date: estimate.min } : {}),
        ...(estimate?.max ? { max_delivery_date: estimate.max } : {}),
      },
    ];
  });
  return {
    rates,
    reason:
      decision.source === "fallback"
        ? "store-fallback"
        : rates.length
          ? "matched"
          : "no-match",
    trace,
  };
}

function conditionExpectation(condition: RateCondition) {
  const kind = conditionDefinitions[condition.field].kind;
  const units =
    condition.currency ??
    condition.weightUnit ??
    condition.distanceUnit ??
    condition.dimensionUnit ??
    (kind === "volume" ? "cm³" : kind === "volumetric" ? "kg" : undefined);
  return [
    operatorLabels[condition.operator],
    condition.value,
    condition.upper ? `and ${condition.upper}` : "",
    units ?? "",
    condition.provinceCountry ? `in ${condition.provinceCountry}` : "",
    condition.scope
      ? `(${{ ...basicScopes, ...advancedProductScopes }[condition.scope]}${condition.scopeValue ? `: ${condition.scopeValue}` : ""})`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function conditionOutcome(
  condition: RateCondition,
  cart: CarrierCart,
): ConditionOutcome {
  const { kind } = conditionDefinitions[condition.field];
  if (
    kind === "money" &&
    (condition.currency !== cart.currency ||
      (condition.field === "previousSpent" &&
        cart.customer?.spentCurrency &&
        cart.customer.spentCurrency !== cart.currency))
  )
    return "currency";
  const result = matchesCondition(condition, cart);
  return result === null ? "missing" : result ? "matched" : "unmatched";
}

export function testIdentity(cart: CarrierCart) {
  return !cart.firstName
    ? "missing"
    : isTestCheckout(cart.firstName)
      ? "test"
      : "other";
}

export const productConditionFields: Partial<
  Record<ConditionField, ProductField | "name">
> = {
  productName: "name",
  productVendor: "vendor",
  productSku: "sku",
  productTag: "tags",
  productType: "productType",
  productBarcode: "barcode",
  productCollection: "collections",
};
const customerTextFields: Partial<
  Record<
    ConditionField,
    "name" | "email" | "phone" | "fax" | "address" | "company"
  >
> = {
  customerName: "name",
  customerEmail: "email",
  customerPhone: "phone",
  customerFax: "fax",
  customerAddress: "address",
  customerCompany: "company",
};

function matchesCondition(
  condition: RateCondition,
  cart: CarrierCart,
): boolean | null {
  const { field, operator, value, upper } = condition;
  const { kind, group } = conditionDefinitions[field];
  const expected = textList(value);
  const compare = (actual: string[] | undefined) =>
    actual === undefined ? null : compareText(actual, operator, expected);
  const compareNumber = (actual: number | undefined) => {
    if (actual === undefined) return null;
    const number = (entry: string) =>
      kind === "money" ? parseMoney(entry, cart.currency) : Number(entry);
    return compareNumeric(
      actual,
      operator,
      number(value),
      upper === undefined ? undefined : number(upper),
    );
  };
  const factor = weightGrams[asWeightUnit(condition.weightUnit)];
  const customerField = customerTextFields[field];
  if (customerField) {
    const actual = cart.customer?.[customerField];
    return compare(actual ? [actual] : undefined);
  }
  switch (field) {
    case "cartTotal":
      return compareNumber(cart.subtotal);
    case "cartQuantity":
      return compareNumber(
        cart.lines.reduce((sum, line) => sum + line.quantity, 0),
      );
    case "cartWeight":
      return cart.lines.some((line) => line.grams === null)
        ? null
        : compareNumber(
            cart.lines.reduce(
              (sum, line) => sum + (line.grams ?? 0) * line.quantity,
              0,
            ) / factor,
          );
    case "cartLength":
    case "cartWidth":
    case "cartHeight": {
      const axis = field.slice(4).toLowerCase() as DimensionAxis;
      if (cart.lines.some((line) => line.dimensions?.[axis] == null))
        return null;
      return compareNumber(
        displayDimension(
          cart.lines.reduce(
            (largest, line) => Math.max(largest, line.dimensions![axis]!),
            0,
          ),
          condition.dimensionUnit ?? "cm",
        ),
      );
    }
    case "cartDistance":
      return compareNumber(
        cart.distanceMeters === undefined
          ? undefined
          : cart.distanceMeters / distanceUnits[condition.distanceUnit ?? "km"],
      );
    case "cartVolume":
    case "cartVolumetric": {
      const volume = totalVolume(cart.lines);
      return compareNumber(
        volume === undefined
          ? undefined
          : field === "cartVolume"
            ? volume
            : volume / dimensionalFactor(cart.volumetricDivisor),
      );
    }
    case "postalCode": {
      if (!cart.postalCode) return null;
      const uk = cart.destination.country === "GB";
      const patterns = expected.filter(
        (pattern) => !uk || cart.ukPostal || !/[_*]/.test(pattern),
      );
      if (!patterns.length) return null;
      return compareText(
        [cart.postalCode],
        operator,
        patterns,
        (actual, pattern) =>
          uk && !/[_*:]/.test(pattern)
            ? actual.replace(/\s/g, "") === pattern.replace(/\s/g, "")
            : postalMatch(actual, pattern),
      );
    }
    case "country":
      return compare([cart.destination.country]);
    case "province":
      if (
        condition.provinceCountry &&
        cart.destination.country !== condition.provinceCountry
      )
        return false;
      return compare(
        cart.destination.province ? [cart.destination.province] : undefined,
      );
    case "city":
      return compare(cart.city ? [cart.city] : undefined);
    case "customerTag":
      return compare(cart.customerTags);
    case "previousOrders":
      return compareNumber(cart.customer?.previousOrders);
    case "previousSpent":
      return compareNumber(cart.customer?.previousSpent);
  }
  if (group !== "Product") return null;
  const results = cart.lines.map((line) => {
    switch (field) {
      case "productTotal":
        return compareNumber(line.price * line.quantity);
      case "productPrice":
        return compareNumber(line.price);
      case "productQuantity":
        return compareNumber(line.quantity);
      case "productLength":
      case "productWidth":
      case "productHeight": {
        const size =
          line.dimensions?.[field.slice(7).toLowerCase() as DimensionAxis];
        return compareNumber(
          size == null
            ? undefined
            : displayDimension(size, condition.dimensionUnit ?? "cm"),
        );
      }
      case "productVolume":
      case "productVolumetric": {
        const volume = lineVolume(line);
        if (volume === undefined) return null;
        const total = volume * (condition.individual ? 1 : line.quantity);
        return compareNumber(
          field === "productVolume"
            ? total
            : total / dimensionalFactor(cart.volumetricDivisor),
        );
      }
      case "productWeight":
        return line.grams === null
          ? null
          : compareNumber(
              (line.grams * (condition.individual ? 1 : line.quantity)) /
                factor,
            );
    }
    const attribute = productConditionFields[field];
    if (attribute === "name")
      return compare(line.name === undefined ? undefined : [line.name]);
    return attribute ? compare(productValues(line, attribute)) : null;
  });
  const scope = condition.scope ?? "any";
  if (scope === "any") return resolveMatch(results, false);
  if (scope === "all") return resolveMatch(results, true);
  if (scope === "none")
    return resolveMatch(
      results.map((result) => (result === null ? null : !result)),
      true,
    );
  const filter = {
    field: scope.startsWith("tag") ? "tags" : "sku",
    operator: scope.includes("prefix") ? "starts" : "eq",
    value: condition.scopeValue ?? "",
  } as const;
  if (scope.endsWith("filter")) {
    const selected = cart.lines.flatMap((line, index) => {
      const qualified = productMatches(line, filter);
      return qualified === false
        ? []
        : [qualified === null ? null : results[index]];
    });
    return resolveMatch(selected, true);
  }
  const qualifying = results.flatMap((result, index) =>
    result === false
      ? []
      : [result === null ? null : productMatches(cart.lines[index], filter)],
  );
  return resolveMatch(qualifying, !scope.endsWith("any"));
}

function resolveMatch(results: (boolean | null)[], all: boolean) {
  if (!results.length) return false;
  if (results.includes(!all)) return !all;
  return results.includes(null) ? null : all;
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

function postalMatch(actual: string, expected: string) {
  if (expected.includes(":")) {
    const [min, max] = expected.split(":").map(Number);
    return (
      /^\d+$/.test(actual) && min <= Number(actual) && Number(actual) <= max
    );
  }
  const pattern = expected.replaceAll("_", " ");
  if (expected.endsWith("_")) return actual.startsWith(pattern);
  return pattern.endsWith("*")
    ? actual.startsWith(pattern.slice(0, -1))
    : actual === pattern;
}

function nonnegativeInt(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function optionalText(value: unknown) {
  return textValue(value) || undefined;
}
