import type { UnitInput } from "./shop-settings.server";

export type UnitFormValues = Record<keyof UnitInput, string>;

export function unitFormValuesFromSettings(
  settings: {
    weightUnit: string;
    distanceUnit: string;
    dimensionUnit: string;
    volumetricDivisor: number;
  },
): UnitFormValues {
  return {
    weightUnit: settings.weightUnit,
    distanceUnit: settings.distanceUnit,
    dimensionUnit: settings.dimensionUnit,
    volumetricDivisor: String(settings.volumetricDivisor),
  };
}

export function unitFormValuesAreDirty(
  values: UnitFormValues,
  savedValues: UnitFormValues,
) {
  return (Object.keys(savedValues) as Array<keyof UnitFormValues>).some(
    (key) => values[key] !== savedValues[key],
  );
}

const weightUnits = ["g", "kg", "lb", "oz"];
const distanceUnits = ["km", "mi"];
const dimensionUnits = ["mm", "cm", "m", "in", "ft"];

export function validateUnitFormValues(values: UnitFormValues) {
  const errors: Partial<Record<keyof UnitFormValues, string>> = {};
  const divisor = Number(values.volumetricDivisor);

  if (!weightUnits.includes(values.weightUnit)) {
    errors.weightUnit = "Choose a weight unit.";
  }
  if (!distanceUnits.includes(values.distanceUnit)) {
    errors.distanceUnit = "Choose a distance unit.";
  }
  if (!dimensionUnits.includes(values.dimensionUnit)) {
    errors.dimensionUnit = "Choose a dimension unit.";
  }
  if (
    values.volumetricDivisor.trim() === "" ||
    !Number.isFinite(divisor) ||
    divisor <= 0
  ) {
    errors.volumetricDivisor =
      "Enter a volumetric divisor greater than 0.";
  }

  return errors;
}
