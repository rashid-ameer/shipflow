import { DIMENSION_UNITS, type DimensionUnit } from "./shipping-settings";
import { parseDecimal, textValue } from "./checkout-values";

export const productsPath = "/app/products";
export const catalogLimit = 60_000;
export const dimensionAxes = ["length", "width", "height"] as const;
export type DimensionAxis = (typeof dimensionAxes)[number];
export type Dimensions = Record<DimensionAxis, number | null>;
export type DimensionValues = Record<DimensionAxis, string>;
export type DimensionMapping = Record<
  DimensionAxis,
  {
    namespace: string;
    key: string;
    owner: "variant" | "product";
  }
>;

const centimeters: Record<DimensionUnit, number> = {
  mm: 0.1,
  cm: 1,
  m: 100,
  in: 2.54,
  ft: 30.48,
};

export function asDimensionUnit(value: unknown): DimensionUnit {
  return DIMENSION_UNITS.find((unit) => unit === value) ?? "cm";
}

export function dimensionInCm(value: number, unit: DimensionUnit) {
  return Number((value * centimeters[unit]).toPrecision(12));
}

export function displayDimension(value: number, unit: DimensionUnit) {
  return Number((value / centimeters[unit]).toPrecision(12));
}

export function formatDimension(value: number, unit: DimensionUnit) {
  return displayDimension(value, unit)
    .toFixed(12)
    .replace(/\.?0+$/, "");
}

export function readDimensions(
  values: DimensionValues,
  unit: DimensionUnit,
): Dimensions {
  return Object.fromEntries(
    dimensionAxes.map((axis) => {
      const raw = textValue(values[axis]);
      if (!raw) return [axis, null];
      const number = parseDecimal(raw, 12);
      const cm = dimensionInCm(number, unit);
      if (cm <= 0 || cm > 1_000_000)
        throw new Error(`Enter a positive ${axis} up to 10,000 meters.`);
      return [axis, cm];
    }),
  ) as Dimensions;
}

export function readDimensionMapping(input: unknown): DimensionMapping {
  const mapping = input as Partial<DimensionMapping> | null;
  return Object.fromEntries(
    dimensionAxes.map((axis) => {
      const field = mapping?.[axis];
      const namespace = textValue(field?.namespace);
      const key = textValue(field?.key);
      const owner = field?.owner === "product" ? "product" : "variant";
      if (
        (namespace || key) &&
        (!/^(?:[a-zA-Z0-9_-]{1,255}|\$app(?::[a-zA-Z0-9_-]+)?)$/.test(
          namespace,
        ) ||
          !/^[a-zA-Z0-9_-]{1,64}$/.test(key))
      )
        throw new Error(`Enter a valid namespace and key for ${axis}.`);
      return [axis, { namespace, key, owner }];
    }),
  ) as DimensionMapping;
}

export function metafieldDimension(
  field: { type: string; jsonValue: unknown } | undefined,
  unit: DimensionUnit,
) {
  if (!field) return undefined;
  const size = field.jsonValue as { value?: unknown; unit?: unknown } | null;
  const typed = field.type === "dimension";
  if (typed && !DIMENSION_UNITS.includes(size?.unit as DimensionUnit))
    return undefined;
  if (!typed && !["number_decimal", "number_integer"].includes(field.type))
    return undefined;
  const raw = typed ? size?.value : field.jsonValue;
  if (typeof raw !== "number" && typeof raw !== "string") return undefined;
  if (typeof raw === "string" && !/^\d+(?:\.\d+)?$/.test(raw)) return undefined;
  const value = dimensionInCm(
    Number(raw),
    typed ? asDimensionUnit(size?.unit) : unit,
  );
  return Number.isFinite(value) && value > 0 && value <= 1_000_000
    ? value
    : undefined;
}

type SizedLine = { quantity: number; dimensions?: Dimensions };

export function lineVolume(line: SizedLine) {
  const { length, width, height } = line.dimensions ?? {};
  return length && width && height ? length * width * height : undefined;
}

export function totalVolume(lines: SizedLine[], individual = false) {
  let volume = 0;
  for (const line of lines) {
    const size = lineVolume(line);
    if (size === undefined) return undefined;
    volume += size * (individual ? 1 : line.quantity);
  }
  return volume;
}

export function dimensionalFactor(value?: number) {
  return value && value > 0 && Number.isFinite(value) ? value : 5_000;
}
