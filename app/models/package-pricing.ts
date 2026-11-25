import type { CarrierCart } from "./calculated-rates";
import {
  asWeightUnit,
  formatRateAmount,
  parseDecimal,
  parseMoney,
  textValue,
  weightGrams,
  type WeightUnit,
} from "./checkout-values";
import {
  asDimensionUnit,
  dimensionAxes,
  dimensionalFactor,
  dimensionInCm,
  lineVolume,
  readDimensions,
  totalVolume,
} from "./product-dimensions";
import type { DimensionUnit } from "./shipping-settings";

export const splitLabels = {
  quantity: "Cart quantity",
  total: "Cart total",
  weight: "Cart weight",
  volume: "Cart volume",
  volumetric: "Cart volumetric weight",
} as const;
type Split = keyof typeof splitLabels;
export type PackageDraft = {
  name: string;
  rate: string;
  limit: string;
  maxWeight: string;
  emptyWeight: string;
  length: string;
  width: string;
  height: string;
};
export type PackagePricing = {
  method: "attributes" | "dimensions";
  split: Split;
  algorithm: "largest-package" | "largest-item";
  stack: "length" | "width";
  rotate: boolean;
  weightUnit?: WeightUnit;
  dimensionUnit?: DimensionUnit;
  packages: PackageDraft[];
};

export const emptyPackage: PackageDraft = {
  name: "",
  rate: "",
  limit: "",
  maxWeight: "",
  emptyWeight: "",
  length: "",
  width: "",
  height: "",
};
export const emptyPacking: PackagePricing = {
  method: "attributes",
  split: "quantity",
  algorithm: "largest-item",
  stack: "length",
  rotate: false,
  packages: [],
};

export function splitUnit(split: Split, currency: string, weightUnit: string) {
  return {
    quantity: "items",
    total: currency,
    weight: weightUnit,
    volume: "cm³",
    volumetric: "kg",
  }[split];
}

function capacity(raw: string, split: Split, currency: string) {
  return split === "total"
    ? parseMoney(raw, currency)
    : parseDecimal(raw, split === "quantity" ? 0 : 3);
}

export function validatePacking(
  input: PackagePricing | undefined,
  currency: string,
  amountType: "fixed" | "percent",
  weightUnit: string,
  dimensionUnit: string,
): PackagePricing {
  if (
    !input ||
    !["attributes", "dimensions"].includes(input.method) ||
    !Object.hasOwn(splitLabels, input.split) ||
    !["largest-package", "largest-item"].includes(input.algorithm) ||
    !["length", "width"].includes(input.stack) ||
    !Array.isArray(input.packages) ||
    input.packages.length < 1 ||
    input.packages.length > 30
  )
    throw new Error(
      "Choose a packing method and add between 1 and 30 packages.",
    );
  const weight = asWeightUnit(input.weightUnit ?? weightUnit);
  const unit = asDimensionUnit(input.dimensionUnit ?? dimensionUnit);
  const packages = input.packages.map((raw) => {
    if (!raw || typeof raw !== "object")
      throw new Error("Enter valid package details.");
    const next = Object.fromEntries(
      Object.keys(emptyPackage).map((key) => [
        key,
        textValue(raw[key as keyof PackageDraft]),
      ]),
    ) as PackageDraft;
    if (!next.name || next.name.length > 120)
      throw new Error("Enter a package name up to 120 characters.");
    if (amountType === "fixed") parseMoney(next.rate, currency);
    else parseDecimal(next.rate, 3);
    if (input.method === "attributes") {
      if (capacity(next.limit, input.split, currency) <= 0)
        throw new Error("Package limits must be greater than zero.");
      return {
        ...emptyPackage,
        name: next.name,
        rate: next.rate,
        limit: next.limit,
      };
    }
    const dims = readDimensions(next, unit);
    const max = parseDecimal(next.maxWeight, 3);
    const empty = next.emptyWeight ? parseDecimal(next.emptyWeight, 3) : 0;
    if (dimensionAxes.some((axis) => dims[axis] === null) || max <= empty)
      throw new Error(
        "Enter all package dimensions and a maximum weight above the empty weight.",
      );
    return { ...next, limit: "" };
  });
  if (
    new Set(packages.map(({ name }) => name.toLowerCase())).size !==
    packages.length
  )
    throw new Error("Use a different name for each package.");
  return {
    method: input.method,
    split: input.split,
    algorithm: input.algorithm,
    stack: input.stack,
    rotate: input.rotate === true,
    weightUnit: weight,
    dimensionUnit: unit,
    packages,
  };
}

type Line = CarrierCart["lines"][number];
type Packed = { package: PackageDraft; count: number; detail?: string };
type PackingResult =
  Packed[] | { reason: "missing-input" | "no-package"; detail: string };

export function packByAttributes(
  packing: PackagePricing,
  lines: Line[],
  cart: CarrierCart,
  subtotal: number,
): PackingResult {
  const weight = packing.weightUnit ?? "kg";
  const volume = () => totalVolume(lines);
  const measures = {
    quantity: () => lines.reduce((sum, line) => sum + line.quantity, 0),
    total: () => subtotal,
    weight: () =>
      lines.some(({ grams }) => grams === null)
        ? undefined
        : lines.reduce((sum, line) => sum + line.grams! * line.quantity, 0) /
          weightGrams[weight],
    volume,
    volumetric: () => {
      const cm = volume();
      return cm === undefined
        ? undefined
        : cm / dimensionalFactor(cart.volumetricDivisor);
    },
  };
  const amount = measures[packing.split]();
  if (amount === undefined)
    return {
      reason: "missing-input",
      detail: `${splitLabels[packing.split]} is unavailable for one or more items.`,
    };
  const packages = packing.packages
    .map((box) => ({
      box,
      limit: capacity(box.limit, packing.split, cart.currency),
    }))
    .sort((a, b) => a.limit - b.limit);
  const largest = packages.at(-1)!;
  const full = Math.floor(amount / largest.limit);
  const remaining = amount - full * largest.limit;
  const remainder =
    remaining > 0.000000001 || !full
      ? packages.find(({ limit }) => limit + 0.000000001 >= remaining)
      : undefined;
  const formatted =
    packing.split === "total"
      ? formatRateAmount(amount, cart.currency)
      : Intl.NumberFormat("en", { maximumFractionDigits: 3 }).format(amount);
  const detail = `${splitLabels[packing.split]} ${formatted} ${splitUnit(packing.split, cart.currency, weight)} · max `;
  return packages.flatMap(({ box }) => {
    const count =
      (box === largest.box ? full : 0) + (box === remainder?.box ? 1 : 0);
    return count ? [{ package: box, count, detail: detail + box.limit }] : [];
  });
}

type Size = [number, number, number];

function orientations(size: Size, rotate: boolean): Size[] {
  const [l, w, h] = size;
  return rotate
    ? [size, [l, h, w], [w, l, h], [w, h, l], [h, l, w], [h, w, l]]
    : [size];
}

export function packByDimensions(
  packing: PackagePricing,
  lines: Line[],
): PackingResult {
  const stack = packing.stack === "length" ? 0 : 1;
  const grams = weightGrams[packing.weightUnit ?? "kg"];
  const unit = packing.dimensionUnit ?? "cm";
  const boxes = packing.packages
    .map((box) => {
      const size = dimensionAxes.map((axis) =>
        dimensionInCm(Number(box[axis]), unit),
      ) as Size;
      return {
        box,
        size,
        capacity: (Number(box.maxWeight) - Number(box.emptyWeight)) * grams,
      };
    })
    .sort((a, b) => {
      const volume = (size: Size) => size[0] * size[1] * size[2];
      const factor = packing.algorithm === "largest-package" ? -1 : 1;
      return (
        factor * (volume(a.size) - volume(b.size) || a.capacity - b.capacity)
      );
    });
  type Bin = {
    box: (typeof boxes)[number];
    space: number;
    grams: number;
    count: number;
  };
  let open: Bin[] = [];
  const items = [...lines].sort(
    (a, b) => (lineVolume(b) ?? 0) - (lineVolume(a) ?? 0),
  );
  const counts = new Map<PackageDraft, number>();
  for (const item of items) {
    const label = item.name || item.sku || "A cart item";
    if (!lineVolume(item) || item.grams === null)
      return {
        reason: "missing-input",
        detail: `${label} needs length, width, height, and weight for dimension-based packing.`,
      };
    const size = dimensionAxes.map((axis) => item.dimensions![axis]!) as Size;
    const rotations = orientations(size, packing.rotate).sort(
      (a, b) => a[stack] - b[stack],
    );
    const fit = (box: (typeof boxes)[number], space: number) =>
      rotations.find((rotation) =>
        rotation.every(
          (axis, index) =>
            axis <= (index === stack ? space : box.size[index]) + 1e-9,
        ),
      );
    let quantity = item.quantity;
    function fitCount(space: number, remainingGrams: number, axis: number) {
      return Math.min(
        Math.floor((space + 1e-9) / axis),
        item.grams
          ? Math.floor((remainingGrams + 1e-9) / item.grams)
          : Infinity,
      );
    }
    open = open.flatMap((bin): Bin[] => {
      if (!quantity) return [bin];
      const rotation = fit(bin.box, bin.space);
      const units = rotation
        ? fitCount(bin.space, bin.grams, rotation[stack])
        : 0;
      if (!units) return [bin];
      const full = Math.min(bin.count, Math.floor(quantity / units));
      quantity -= full * units;
      const remaining = bin.count - full;
      const partial = remaining > 0 ? Math.min(quantity, units) : 0;
      quantity -= partial;
      const result: Bin[] = [];
      if (full && bin.space - units * rotation![stack] > 1e-9)
        result.push({
          ...bin,
          count: full,
          space: bin.space - units * rotation![stack],
          grams: bin.grams - units * item.grams!,
        });
      if (partial)
        result.push({
          ...bin,
          count: 1,
          space: bin.space - partial * rotation![stack],
          grams: bin.grams - partial * item.grams!,
        });
      if (remaining > Number(Boolean(partial)))
        result.push({ ...bin, count: remaining - Number(Boolean(partial)) });
      return result;
    });
    if (!quantity) continue;
    const box = boxes.find(
      (candidate) =>
        item.grams! <= candidate.capacity + 1e-9 &&
        fit(candidate, candidate.size[stack]),
    );
    if (!box)
      return {
        reason: "no-package",
        detail: `No package fits ${label} at its dimensions and weight.`,
      };
    const rotation = fit(box, box.size[stack])!;
    const perBox = fitCount(box.size[stack], box.capacity, rotation[stack]);
    const count = Math.ceil(quantity / perBox);
    const units = quantity - (count - 1) * perBox;
    // Full boxes can still have space for a narrower or lighter item.
    for (const [boxCount, filled] of [
      [count - 1, perBox],
      [1, units],
    ]) {
      const space = box.size[stack] - filled * rotation[stack];
      if (boxCount && space > 1e-9)
        open.push({
          box,
          count: boxCount,
          space,
          grams: box.capacity - filled * item.grams,
        });
    }
    counts.set(box.box, (counts.get(box.box) ?? 0) + count);
  }
  return [...counts].map(([box, count]) => ({ package: box, count }));
}
