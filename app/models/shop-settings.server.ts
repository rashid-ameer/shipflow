import type {
  CcsStatus as CcsStatusType,
  OnboardingStep as OnboardingStepType,
  OperatingMode as OperatingModeType,
  Store,
  StoreSettings,
} from "@prisma/client";

import prisma from "../db.server";

const OnboardingStep = {
  WELCOME: "WELCOME",
  UNITS: "UNITS",
  MODE: "MODE",
  COMPLETE: "COMPLETE",
} as const satisfies Record<string, OnboardingStepType>;

const OperatingMode = {
  DELIVERY_CUSTOMIZATION: "DELIVERY_CUSTOMIZATION",
  CCS_RATES: "CCS_RATES",
} as const satisfies Record<string, OperatingModeType>;

const CcsStatus = {
  UNKNOWN: "UNKNOWN",
  ENABLED: "ENABLED",
  DISABLED: "DISABLED",
} as const satisfies Record<string, CcsStatusType>;

const WEIGHT_UNITS = ["g", "kg", "lb", "oz"] as const;
const DISTANCE_UNITS = ["km", "mi"] as const;
const DIMENSION_UNITS = ["mm", "cm", "m", "in", "ft"] as const;

export type WeightUnit = (typeof WEIGHT_UNITS)[number];
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];
export type ShopWithSettings = Store & { settings: StoreSettings };

export type UnitInput = {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  dimensionUnit: DimensionUnit;
  volumetricDivisor: number;
};

export type UnitValidationResult =
  | { ok: true; value: UnitInput }
  | {
      ok: false;
      fields: Partial<Record<keyof UnitInput, string>>;
      values: Record<string, string>;
    };

const onboardingPath: Record<OnboardingStepType, string> = {
  [OnboardingStep.WELCOME]: "/app/onboarding",
  [OnboardingStep.UNITS]: "/app/onboarding/units",
  [OnboardingStep.MODE]: "/app/onboarding/mode",
  [OnboardingStep.COMPLETE]: "/app",
};

export function nextOnboardingPath(step: OnboardingStepType) {
  return onboardingPath[step];
}

export function parseOperatingMode(value: FormDataEntryValue | null) {
  if (value === "delivery-customization") {
    return OperatingMode.DELIVERY_CUSTOMIZATION;
  }
  if (value === "ccs-rates") return OperatingMode.CCS_RATES;
  return null;
}

export function parseUnits(formData: FormData): UnitValidationResult {
  const values = {
    weightUnit: String(formData.get("weightUnit") ?? ""),
    distanceUnit: String(formData.get("distanceUnit") ?? ""),
    dimensionUnit: String(formData.get("dimensionUnit") ?? ""),
    volumetricDivisor: String(formData.get("volumetricDivisor") ?? ""),
  };
  const fields: Partial<Record<keyof UnitInput, string>> = {};
  const volumetricDivisor = Number(values.volumetricDivisor);

  if (!WEIGHT_UNITS.includes(values.weightUnit as WeightUnit)) {
    fields.weightUnit = "Choose a weight unit.";
  }
  if (!DISTANCE_UNITS.includes(values.distanceUnit as DistanceUnit)) {
    fields.distanceUnit = "Choose a distance unit.";
  }
  if (!DIMENSION_UNITS.includes(values.dimensionUnit as DimensionUnit)) {
    fields.dimensionUnit = "Choose a dimension unit.";
  }
  if (!Number.isFinite(volumetricDivisor) || volumetricDivisor <= 0) {
    fields.volumetricDivisor =
      "Enter a volumetric divisor greater than 0.";
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields, values };

  return {
    ok: true,
    value: {
      weightUnit: values.weightUnit as WeightUnit,
      distanceUnit: values.distanceUnit as DistanceUnit,
      dimensionUnit: values.dimensionUnit as DimensionUnit,
      volumetricDivisor,
    },
  };
}

export async function getOrCreateShop(shopDomain: string): Promise<ShopWithSettings> {
  const store = await prisma.store.upsert({
    where: { shopDomain },
    create: { shopDomain, settings: { create: {} } },
    update: {},
    include: { settings: true },
  });

  if (store.settings) return store as ShopWithSettings;

  const settings = await prisma.storeSettings.create({
    data: { storeId: store.id },
  });
  return { ...store, settings };
}

export async function continueFromWelcome(shopDomain: string) {
  const store = await getOrCreateShop(shopDomain);
  if (store.onboardingStep !== OnboardingStep.WELCOME) return store;

  return prisma.store.update({
    where: { shopDomain },
    data: { onboardingStep: OnboardingStep.UNITS },
    include: { settings: true },
  });
}

export async function saveUnits(shopDomain: string, input: UnitInput) {
  const store = await getOrCreateShop(shopDomain);
  return prisma.store.update({
    where: { id: store.id },
    data: {
      onboardingStep: OnboardingStep.MODE,
      settings: { update: input },
    },
    include: { settings: true },
  });
}

export async function updateUnits(shopDomain: string, input: UnitInput) {
  const store = await getOrCreateShop(shopDomain);
  return prisma.store.update({
    where: { id: store.id },
    data: { settings: { update: input } },
    include: { settings: true },
  });
}

export async function completeOnboarding(
  shopDomain: string,
  mode: OperatingModeType,
) {
  const store = await getOrCreateShop(shopDomain);
  const firstCcsSelection =
    mode === OperatingMode.CCS_RATES && store.ccsModeSelectedAt === null;

  return prisma.store.update({
    where: { id: store.id },
    data: {
      onboardingStep: OnboardingStep.COMPLETE,
      mode,
      onboardedAt: store.onboardedAt ?? new Date(),
      testMode: firstCcsSelection ? true : store.testMode,
      ccsModeSelectedAt: firstCcsSelection ? new Date() : undefined,
    },
    include: { settings: true },
  });
}

export async function switchOperatingMode(
  shopDomain: string,
  mode: OperatingModeType,
) {
  const store = await getOrCreateShop(shopDomain);
  if (store.onboardingStep !== OnboardingStep.COMPLETE || store.mode === null) {
    throw new Response("Finish onboarding before switching modes.", {
      status: 409,
    });
  }
  if (store.mode === mode) return store;

  const firstCcsSelection =
    mode === OperatingMode.CCS_RATES && store.ccsModeSelectedAt === null;

  return prisma.store.update({
    where: { id: store.id },
    data: {
      mode,
      testMode: firstCcsSelection ? true : store.testMode,
      ccsModeSelectedAt: firstCcsSelection ? new Date() : undefined,
    },
    include: { settings: true },
  });
}

export function ccsNeedsAttention(status: CcsStatusType) {
  return status !== CcsStatus.ENABLED;
}

export { CcsStatus, OnboardingStep, OperatingMode };
