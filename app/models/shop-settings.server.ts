import type {
  CcsStatus as CcsStatusType,
  OnboardingStep as OnboardingStepType,
  OperatingMode as OperatingModeType,
  Prisma,
  Store,
  StoreSettings,
} from "@prisma/client";

import prisma from "../db.server";
import {
  validateUnitFormValues,
  type BasicSettingsInput,
  type DeliverySettingsInput,
  type DimensionUnit,
  type DistanceUnit,
  type UnitInput,
  type WeightUnit,
} from "./shipping-settings";

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

export type ShopWithSettings = Store & { settings: StoreSettings };

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
  const fields = validateUnitFormValues(values);
  const volumetricDivisor = Number(values.volumetricDivisor);

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

export async function getOrCreateShop(
  shopDomain: string,
): Promise<ShopWithSettings> {
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

export async function updateBasicSettings(
  shopDomain: string,
  input: BasicSettingsInput,
): Promise<ShopWithSettings> {
  const store = await getOrCreateShop(shopDomain);
  const {
    appEnabled,
    weightUnit,
    distanceUnit,
    dimensionUnit,
    volumetricDivisor,
    multipleRates,
    rounding,
  } = input;
  const updated = await prisma.store.update({
    where: { id: store.id, mode: OperatingMode.CCS_RATES },
    data: {
      appEnabled,
      settings: {
        update: {
          weightUnit,
          distanceUnit,
          dimensionUnit,
          volumetricDivisor,
          multipleRates,
          rounding,
        },
      },
    },
    include: { settings: true },
  });
  return updated as ShopWithSettings;
}

export async function updateDeliverySettings(
  shopDomain: string,
  input: DeliverySettingsInput,
  db: Prisma.TransactionClient = prisma,
): Promise<ShopWithSettings> {
  const updated = await db.store.update({
    where: { shopDomain, mode: OperatingMode.DELIVERY_CUSTOMIZATION },
    data: {
      appEnabled: input.appEnabled,
      settings: { update: { weightUnit: input.weightUnit } },
    },
    include: { settings: true },
  });
  return updated as ShopWithSettings;
}

export async function setTestMode(shopDomain: string, enabled: boolean) {
  const result = await prisma.store.updateMany({
    where: {
      shopDomain,
      onboardingStep: OnboardingStep.COMPLETE,
      mode: OperatingMode.CCS_RATES,
    },
    data: { testMode: enabled },
  });
  if (result.count === 0) {
    throw new Response(
      "Test Mode is available only while CCS Rates is active.",
      {
        status: 409,
      },
    );
  }
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
  db: Prisma.TransactionClient = prisma,
) {
  const store = await db.store.findUnique({
    where: { shopDomain },
    include: { settings: true },
  });
  if (
    !store ||
    store.onboardingStep !== OnboardingStep.COMPLETE ||
    store.mode === null
  ) {
    throw new Response("Finish onboarding before switching modes.", {
      status: 409,
    });
  }
  if (store.mode === mode) return store;

  const firstCcsSelection =
    mode === OperatingMode.CCS_RATES && store.ccsModeSelectedAt === null;

  return db.store.update({
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
export type { DimensionUnit, DistanceUnit, UnitInput, WeightUnit };
