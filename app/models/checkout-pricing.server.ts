import type { Store, StoreSettings } from "@prisma/client";
import prisma from "../db.server";
import {
  evaluateCarrierCart,
  type CarrierCart,
  type PricingResult,
} from "./calculated-rates";
import { loadActivePricing, RateFormError } from "./calculated-rates.server";
import {
  checkoutBlockReason,
  type CheckoutDecisionInput,
} from "./checkout-decision";
import { MULTIPLE_RATE_BEHAVIORS, ROUNDING_METHODS } from "./shipping-settings";

type PricingStore = Pick<
  Store,
  "id" | "mode" | "appEnabled" | "testMode" | "ccsStatus" | "carrierServiceId"
> & {
  settings: Pick<StoreSettings, "multipleRates" | "rounding"> | null;
};

export function getPricingStore(id: string) {
  return prisma.store.findUnique({
    where: { id },
    select: {
      id: true,
      mode: true,
      appEnabled: true,
      testMode: true,
      ccsStatus: true,
      carrierServiceId: true,
      settings: { select: { multipleRates: true, rounding: true } },
    },
  });
}

export async function evaluateStoreCart(
  store: PricingStore,
  cart: CarrierCart,
  options: { simulation: true; scenarioIds?: string[] } | { simulation: false },
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
  const { regions, scenarios } = await loadActivePricing(store.id, scenarioIds);
  if (scenarioIds && scenarios.length !== scenarioIds.length)
    throw new RateFormError(
      "A selected scenario is no longer available. Refresh and try again.",
    );
  return evaluateCarrierCart(
    cart,
    settings,
    regions,
    scenarioIds
      ? scenarios.map((scenario) => ({ ...scenario, active: true }))
      : scenarios,
  );
}
