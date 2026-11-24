export const WEIGHT_UNITS = ["g", "kg", "lb", "oz"] as const;
export const DISTANCE_UNITS = ["km", "mi"] as const;
export const DIMENSION_UNITS = ["mm", "cm", "m", "in", "ft"] as const;
export const MULTIPLE_RATE_BEHAVIORS = [
  "all",
  "highest",
  "lowest",
  "priority",
] as const;
export const ROUNDING_METHODS = [
  "none",
  "nearest-half",
  "nearest-one",
  "ceil",
  "floor",
] as const;

export type WeightUnit = (typeof WEIGHT_UNITS)[number];
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];
export type DimensionUnit = (typeof DIMENSION_UNITS)[number];
export type MultipleRates = (typeof MULTIPLE_RATE_BEHAVIORS)[number];
export type RoundingMethod = (typeof ROUNDING_METHODS)[number];
export type UnitInput = {
  weightUnit: WeightUnit;
  distanceUnit: DistanceUnit;
  dimensionUnit: DimensionUnit;
  volumetricDivisor: number;
};

export type BasicSettingsInput = UnitInput & {
  appEnabled: boolean;
  multipleRates: MultipleRates;
  rounding: RoundingMethod;
};

export type DeliverySettingsInput = Pick<UnitInput, "weightUnit"> & {
  appEnabled: boolean;
};

export type UnitFormValues = Record<keyof UnitInput, string>;

export type BasicSettingsFormValues = UnitFormValues & {
  appStatus: string;
  multipleRates: string;
  rounding: string;
};

export type BasicSettingsField = keyof BasicSettingsFormValues;
export type BasicSettingsErrors = Partial<Record<BasicSettingsField, string>>;

export type BasicSettingsValidationResult =
  | { ok: true; value: BasicSettingsInput; values: BasicSettingsFormValues }
  | { ok: false; fields: BasicSettingsErrors; values: BasicSettingsFormValues };

export type DeliverySettingsValidationResult =
  | { ok: true; value: DeliverySettingsInput; values: BasicSettingsFormValues }
  | { ok: false; fields: BasicSettingsErrors; values: BasicSettingsFormValues };

type PersistedSettings = {
  appEnabled: boolean;
  settings: {
    weightUnit: string;
    distanceUnit: string;
    dimensionUnit: string;
    volumetricDivisor: number;
    multipleRates: string;
    rounding: string;
  };
};

export function settingsFormValuesFromStore(
  store: PersistedSettings,
): BasicSettingsFormValues {
  return {
    appStatus: store.appEnabled ? "enabled" : "disabled",
    weightUnit: store.settings.weightUnit,
    distanceUnit: store.settings.distanceUnit,
    dimensionUnit: store.settings.dimensionUnit,
    volumetricDivisor: String(store.settings.volumetricDivisor),
    multipleRates: store.settings.multipleRates,
    rounding: store.settings.rounding,
  };
}

export function settingsFormValuesAreDirty(
  values: BasicSettingsFormValues,
  savedValues: BasicSettingsFormValues,
  mode: "ccs-rates" | "delivery-customization",
) {
  const fields: BasicSettingsField[] =
    mode === "ccs-rates"
      ? [
          "appStatus",
          "weightUnit",
          "distanceUnit",
          "dimensionUnit",
          "volumetricDivisor",
          "multipleRates",
          "rounding",
        ]
      : ["appStatus", "weightUnit"];

  return fields.some((field) => values[field] !== savedValues[field]);
}

export function validateBasicSettingsFormValues(
  values: BasicSettingsFormValues,
): BasicSettingsErrors {
  const errors: BasicSettingsErrors = {
    ...validateDeliverySettingsFormValues(values),
    ...validateUnitFormValues(values),
  };
  if (
    !MULTIPLE_RATE_BEHAVIORS.includes(values.multipleRates as MultipleRates)
  ) {
    errors.multipleRates = "Choose how multiple rates are returned.";
  }
  if (!ROUNDING_METHODS.includes(values.rounding as RoundingMethod)) {
    errors.rounding = "Choose a rounding method.";
  }

  return errors;
}

export function validateUnitFormValues(values: UnitFormValues) {
  const errors: Partial<Record<keyof UnitFormValues, string>> = {};
  if (!WEIGHT_UNITS.includes(values.weightUnit as WeightUnit)) {
    errors.weightUnit = "Choose a weight unit.";
  }
  if (!DISTANCE_UNITS.includes(values.distanceUnit as DistanceUnit)) {
    errors.distanceUnit = "Choose a distance unit.";
  }
  if (!DIMENSION_UNITS.includes(values.dimensionUnit as DimensionUnit)) {
    errors.dimensionUnit = "Choose a dimension unit.";
  }
  const divisor = Number(values.volumetricDivisor);
  if (!Number.isFinite(divisor) || divisor <= 0) {
    errors.volumetricDivisor = "Enter a volumetric divisor greater than 0.";
  }
  return errors;
}

export function validateDeliverySettingsFormValues(
  values: BasicSettingsFormValues,
): BasicSettingsErrors {
  const errors: BasicSettingsErrors = {};
  if (values.appStatus !== "enabled" && values.appStatus !== "disabled") {
    errors.appStatus = "Choose whether ShipFlow is enabled.";
  }
  if (!WEIGHT_UNITS.includes(values.weightUnit as WeightUnit)) {
    errors.weightUnit = "Choose a weight unit.";
  }
  return errors;
}

export function parseBasicSettingsFormData(
  formData: FormData,
): BasicSettingsValidationResult {
  const values = valuesFromFormData(formData);
  const fields = validateBasicSettingsFormValues(values);
  if (Object.keys(fields).length > 0) return { ok: false, fields, values };

  return {
    ok: true,
    values,
    value: {
      appEnabled: values.appStatus === "enabled",
      weightUnit: values.weightUnit as WeightUnit,
      distanceUnit: values.distanceUnit as DistanceUnit,
      dimensionUnit: values.dimensionUnit as DimensionUnit,
      volumetricDivisor: Number(values.volumetricDivisor),
      multipleRates: values.multipleRates as MultipleRates,
      rounding: values.rounding as RoundingMethod,
    },
  };
}

export function parseDeliverySettingsFormData(
  formData: FormData,
): DeliverySettingsValidationResult {
  const values = valuesFromFormData(formData);
  const fields = validateDeliverySettingsFormValues(values);
  if (Object.keys(fields).length > 0) return { ok: false, fields, values };

  return {
    ok: true,
    values,
    value: {
      appEnabled: values.appStatus === "enabled",
      weightUnit: values.weightUnit as WeightUnit,
    },
  };
}

function valuesFromFormData(formData: FormData): BasicSettingsFormValues {
  return {
    appStatus: String(formData.get("appStatus") ?? ""),
    weightUnit: String(formData.get("weightUnit") ?? ""),
    distanceUnit: String(formData.get("distanceUnit") ?? ""),
    dimensionUnit: String(formData.get("dimensionUnit") ?? ""),
    volumetricDivisor: String(formData.get("volumetricDivisor") ?? ""),
    multipleRates: String(formData.get("multipleRates") ?? ""),
    rounding: String(formData.get("rounding") ?? ""),
  };
}
