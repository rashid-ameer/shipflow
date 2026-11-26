import type { Store, StoreSettings } from "@prisma/client";
import prisma from "../db.server";
import {
  evaluateCarrierCart,
  conditionOutcome,
  matchRegion,
  productConditionFields,
  type CarrierCart,
  type PricingResult,
} from "./calculated-rates";
import { loadActivePricing, RateFormError } from "./calculated-rates.server";
import {
  checkoutBlockReason,
  type CheckoutDecisionInput,
} from "./checkout-decision";
import { MULTIPLE_RATE_BEHAVIORS, ROUNDING_METHODS } from "./shipping-settings";
import { addPricingInputs } from "./checkout-pricing-inputs.server";
import type { AdminQuery } from "./delivery-customization-admin.server";
import { catalogId } from "./catalog-shopify.server";
import { dimensionalFactor } from "./product-dimensions";
import { loadCombinedRules } from "./combined-rates.server";
import { loadLiveQuotes } from "./live-carrier.server";
import { checkoutDistance } from "./maps-distance.server";
import type { Appearance, ShippingConfiguration } from "./checkout-settings";

type PricingStore = Pick<
  Store,
  | "id"
  | "shopDomain"
  | "mode"
  | "appEnabled"
  | "testMode"
  | "ccsStatus"
  | "carrierServiceId"
> & {
  settings:
    | (Pick<
        StoreSettings,
        "multipleRates" | "rounding" | "discountedCartTotal"
      > &
        Partial<
          Pick<
            StoreSettings,
            | "volumetricDivisor"
            | "mapsCredentials"
            | "shippingConfiguration"
            | "checkoutAppearance"
            | "checkoutTimezone"
          >
        >)
    | null;
};

export function getPricingStore(id: string) {
  return prisma.store.findUnique({
    where: { id },
    select: {
      id: true,
      shopDomain: true,
      mode: true,
      appEnabled: true,
      testMode: true,
      ccsStatus: true,
      carrierServiceId: true,
      settings: {
        select: {
          multipleRates: true,
          rounding: true,
          discountedCartTotal: true,
          volumetricDivisor: true,
          mapsCredentials: true,
          shippingConfiguration: true,
          checkoutAppearance: true,
          checkoutTimezone: true,
        },
      },
    },
  });
}

export async function evaluateStoreCart(
  store: PricingStore,
  cart: CarrierCart,
  options: (
    | { simulation: true; scenarioIds?: string[]; combinedIds?: string[] }
    | { simulation: false }
  ) & { getGraphql?: () => Promise<AdminQuery> },
): Promise<PricingResult> {
  const settings: CheckoutDecisionInput = {
    mode:
      store.mode === "CCS_RATES"
        ? "ccs-rates"
        : store.mode === "DELIVERY_CUSTOMIZATION"
          ? "delivery-customization"
          : null,
    appEnabled: store.appEnabled,
    testMode: store.testMode,
    customerFirstName: cart.firstName,
    multipleRates:
      MULTIPLE_RATE_BEHAVIORS.find(
        (item) => item === store.settings?.multipleRates,
      ) ?? "all",
    rounding:
      ROUNDING_METHODS.find((item) => item === store.settings?.rounding) ??
      "none",
  };
  const blocked =
    checkoutBlockReason(settings) ??
    (!options.simulation && store.ccsStatus !== "ENABLED"
      ? "carrier-disabled"
      : null);
  if (blocked) return { rates: [], reason: blocked, trace: null };
  const scenarioIds = options.simulation ? options.scenarioIds : undefined;
  const [{ regions, scenarios }, combinedRules] = await Promise.all([
    loadActivePricing(store.id, scenarioIds),
    loadCombinedRules(
      store.id,
      options.simulation ? options.combinedIds : undefined,
    ),
  ]);
  if (scenarioIds && scenarios.length !== scenarioIds.length)
    throw new RateFormError(
      "A selected scenario is no longer available. Refresh and try again.",
    );
  const active = scenarioIds
    ? scenarios.map((scenario) => ({ ...scenario, active: true }))
    : scenarios;
  const region = matchRegion(regions, cart.destination);
  const eligible = active.flatMap((scenario) => {
    if (!scenario.active || !region) return [];
    const rates = scenario.rates.filter(
      (rate) =>
        rate.active !== false &&
        rate.regionId === region.id &&
        rate.currency === cart.currency,
    );
    return rates.length ? [{ conditions: scenario.conditions, rates }] : [];
  });
  const needsCatalog = eligible.some(
    ({ conditions, rates }) =>
      conditions.some(
        ({ field, scope }) =>
          productConditionFields[field] ||
          /(?:Length|Width|Height|Volume|Volumetric)$/.test(field) ||
          scope?.startsWith("tag") ||
          scope?.startsWith("sku"),
      ) ||
      rates.some(
        ({ pricing, liveCarrier }) =>
          liveCarrier?.packaging === "individual" ||
          liveCarrier?.packaging === "dimensions" ||
          (liveCarrier?.packing &&
            ["volume", "volumetric"].includes(liveCarrier.packing.split)) ||
          pricing?.filter ||
          pricing?.basis === "volume" ||
          pricing?.basis === "volumetric" ||
          (pricing?.packing &&
            (pricing.packing.method === "dimensions" ||
              ["volume", "volumetric"].includes(pricing.packing.split))),
      ),
  );
  const ids = needsCatalog
    ? [
        ...new Set(
          cart.lines.flatMap(({ variantId }) => {
            const id = catalogId(variantId);
            return id ? [id] : [];
          }),
        ),
      ]
    : [];
  const variants = ids.length
    ? await prisma.catalogVariant.findMany({
        where: { storeId: store.id, id: { in: ids } },
        select: {
          id: true,
          length: true,
          width: true,
          height: true,
          sku: true,
          barcode: true,
          product: {
            select: {
              title: true,
              tags: true,
              vendor: true,
              productType: true,
            },
          },
        },
      })
    : [];
  const byVariant = new Map(
    variants.map((variant) => [String(variant.id), variant]),
  );
  const sized = {
    ...cart,
    ukPostal:
      (store.settings?.shippingConfiguration as ShippingConfiguration | null)
        ?.ukPostal ?? false,
    volumetricDivisor: dimensionalFactor(store.settings?.volumetricDivisor),
    lines: variants.length
      ? cart.lines.map((line) => {
          const variant = byVariant.get(line.variantId ?? "");
          if (!variant) return line;
          const { length, width, height, product } = variant;
          return {
            ...line,
            dimensions: { length, width, height },
            name: line.name ?? product.title,
            sku: line.sku ?? variant.sku,
            barcode: line.barcode ?? variant.barcode,
            vendor: line.vendor ?? product.vendor,
            tags: product.tags,
            productType: product.productType,
          };
        })
      : cart.lines,
  };
  const hydrated = options.getGraphql
    ? await addPricingInputs(sized, regions, active, options.getGraphql)
    : sized;
  let effective =
    store.settings?.discountedCartTotal &&
    hydrated.discountedSubtotal !== undefined
      ? { ...hydrated, subtotal: hydrated.discountedSubtotal }
      : hydrated;
  const needsDistance = eligible.some(
    ({ conditions, rates }) =>
      (conditions.some((condition) => condition.field === "cartDistance") ||
        rates.some(({ pricing }) => pricing?.basis === "distance")) &&
      conditions.every(
        (condition) =>
          condition.field === "cartDistance" ||
          conditionOutcome(condition, effective) === "matched",
      ),
  );
  if (needsDistance) {
    const distance = await checkoutDistance(
      effective,
      store.id,
      store.settings?.mapsCredentials,
    );
    effective = {
      ...effective,
      distanceMeters: distance.meters,
      distanceError: distance.error,
    };
  }
  const result = evaluateCarrierCart(
    effective,
    settings,
    regions,
    active,
    combinedRules,
    await loadLiveQuotes(
      store.id,
      effective,
      eligible.flatMap(({ conditions, rates }) =>
        rates.some((rate) => rate.liveCarrier) &&
        conditions.every(
          (condition) => conditionOutcome(condition, effective) === "matched",
        )
          ? rates.filter((rate) => rate.liveCarrier)
          : [],
      ),
      options.simulation || store.testMode,
    ),
    {
      shipping: store.settings?.shippingConfiguration as
        ShippingConfiguration | undefined,
      appearance: store.settings?.checkoutAppearance as Appearance | undefined,
      timezone: store.settings?.checkoutTimezone,
    },
  );
  if (result.trace && effective.subtotal !== cart.subtotal) {
    result.trace.pricingSubtotal = effective.subtotal;
    result.trace.pricingCurrency = cart.currency;
  }
  return result;
}
