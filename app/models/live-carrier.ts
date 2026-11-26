import { parseDecimal, parseMoney } from "./checkout-values";
import { validatePacking, type PackagePricing } from "./package-pricing";

export const carriers = {
  "canada-post": "Canada Post",
  usps: "USPS",
  fedex: "FedEx",
  ups: "UPS",
  dhl: "DHL Express MyDHL",
  sendle: "Sendle",
  "australia-post-pac": "Australia Post PAC",
  "australia-post-eparcel": "Australia Post eParcel",
} as const;

export type CarrierService = { code: string; name: string };
export type LiveCarrierRate = {
  carrier: keyof typeof carriers;
  origin: {
    type: "shopify" | "custom";
    country: string;
    postalCode: string;
    province?: string;
  };
  domestic: string[];
  international: string[];
  selection: "all" | "highest" | "lowest";
  internationalSelection?: "all" | "highest" | "lowest";
  packaging: "individual" | "attributes" | "dimensions";
  packing?: PackagePricing;
  override?: string;
  fallback?: {
    name: string;
    description: string;
    kind: "fixed" | "percent";
    value: string;
  };
};

export const newLiveCarrierRate: LiveCarrierRate = {
  carrier: "ups",
  origin: { type: "shopify", country: "", postalCode: "" },
  domestic: [],
  international: [],
  selection: "all",
  packaging: "individual",
};

export function validateLiveCarrierRate(
  rate: LiveCarrierRate,
  currency: string,
  weight: string,
  dimension: string,
): LiveCarrierRate {
  const selections = ["all", "highest", "lowest"];
  if (
    !Object.hasOwn(carriers, rate.carrier) ||
    !selections.includes(rate.selection) ||
    (rate.internationalSelection !== undefined &&
      !selections.includes(rate.internationalSelection)) ||
    !["individual", "attributes", "dimensions"].includes(rate.packaging)
  )
    throw new Error(
      "Choose a valid carrier, service selection, and packaging method.",
    );
  const serviceCodes = (codes: string[]) => {
    if (
      !Array.isArray(codes) ||
      codes.length > 100 ||
      codes.some(
        (code) => typeof code !== "string" || !/^[a-z0-9-]{1,20}$/i.test(code),
      )
    )
      throw new Error("Select valid carrier services.");
    return [...new Set(codes)];
  };
  const origin = rate.origin;
  if (!origin || !["shopify", "custom"].includes(origin.type))
    throw new Error("Choose an origin for the carrier shipment.");
  const country = String(origin.country ?? "")
    .trim()
    .toUpperCase();
  const postalCode = String(origin.postalCode ?? "").trim();
  const province = String(origin.province ?? "")
    .trim()
    .toUpperCase();
  if (
    origin.type === "custom" &&
    (!/^[A-Z]{2}$/.test(country) ||
      !/^[a-z0-9][a-z0-9 -]{0,15}$/i.test(postalCode) ||
      (province && !/^[A-Z0-9-]{1,8}$/.test(province)))
  )
    throw new Error("Enter a valid origin country and postal code.");
  let packing: PackagePricing | undefined;
  if (rate.packaging !== "individual") {
    if (!rate.packing)
      throw new Error("Add packages for the selected packing method.");
    packing = validatePacking(
      {
        ...rate.packing,
        method: rate.packaging,
        packages: rate.packing.packages.map((box) => ({ ...box, rate: "0" })),
      },
      currency,
      "fixed",
      weight,
      dimension,
      true,
    );
  }
  let fallback: LiveCarrierRate["fallback"];
  if (rate.fallback) {
    const { kind, value } = rate.fallback;
    const name = String(rate.fallback.name ?? "").trim();
    const description = String(rate.fallback.description ?? "").trim();
    if (
      !name ||
      name.length > 120 ||
      description.length > 250 ||
      !["fixed", "percent"].includes(kind)
    )
      throw new Error(
        "Enter a valid fallback name, description, and price type.",
      );
    if (kind === "fixed") parseMoney(value, currency);
    else if (parseDecimal(value, 3) > 1000)
      throw new Error("Use a fallback percentage at or below 1,000%.");
    fallback = { name, description, kind, value };
  }
  const override = rate.override?.trim();
  if (override) parseMoney(override, currency);
  return {
    carrier: rate.carrier,
    origin:
      origin.type === "shopify"
        ? newLiveCarrierRate.origin
        : { type: "custom", country, postalCode, province },
    domestic: serviceCodes(rate.domestic),
    international: serviceCodes(rate.international),
    selection: rate.selection,
    internationalSelection: rate.internationalSelection ?? rate.selection,
    packaging: rate.packaging,
    packing,
    override,
    fallback,
  };
}

export type CarrierQuote = CarrierService & {
  amount: number;
  currency: string;
};
export type CarrierQuoteResult =
  { quotes: CarrierQuote[]; detail?: string } | { error: string };
