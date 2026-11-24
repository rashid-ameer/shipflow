import type { UnitFormValues } from "./shipping-settings";

export {
  validateUnitFormValues,
  type UnitFormValues,
} from "./shipping-settings";

export function unitFormValuesFromSettings(settings: {
  weightUnit: string;
  distanceUnit: string;
  dimensionUnit: string;
  volumetricDivisor: number;
}): UnitFormValues {
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
