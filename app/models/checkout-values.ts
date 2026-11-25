export const textOperators = [
  "eq",
  "ne",
  "contains",
  "notContains",
  "starts",
  "notStarts",
] as const;
export type TextOperator = (typeof textOperators)[number];
export const weightGrams = {
  g: 1,
  kg: 1000,
  lb: 453.59237,
  oz: 28.349523125,
} as const;
export type WeightUnit = keyof typeof weightGrams;

export function asWeightUnit(value: unknown): WeightUnit {
  return typeof value === "string" && Object.hasOwn(weightGrams, value)
    ? (value as WeightUnit)
    : "kg";
}

export function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function textList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function compareText(
  actual: string[],
  operator: string,
  expected: string[],
  equals = (a: string, b: string) => a === b,
) {
  const matches = actual.some((item) =>
    expected.some((value) => {
      const a = item.toUpperCase(),
        b = value.toUpperCase();
      if (operator === "contains" || operator === "notContains")
        return a.includes(b);
      if (operator === "starts" || operator === "notStarts")
        return a.startsWith(b);
      return equals(a, b);
    }),
  );
  return operator === "ne" ||
    operator === "notContains" ||
    operator === "notStarts"
    ? !matches
    : matches;
}

const currencyDecimals = new Map<string, number>();
export function moneyDecimals(currency: string) {
  const cached = currencyDecimals.get(currency);
  if (cached !== undefined) return cached;
  const decimals =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  currencyDecimals.set(currency, decimals);
  return decimals;
}

export function parseDecimal(value: string, decimals: number) {
  if (
    !/^\d+(?:\.\d+)?$/.test(value) ||
    (value.split(".")[1]?.length ?? 0) > decimals ||
    Number(value) > 1_000_000
  )
    throw new Error(
      `Enter a non-negative number up to 1,000,000${decimals ? ` with up to ${decimals} decimal places` : ""}.`,
    );
  return Number(value);
}

export function parseMoney(value: unknown, currency: string) {
  const decimals = moneyDecimals(currency);
  const amount = Math.round(
    parseDecimal(textValue(value), decimals) * 10 ** decimals,
  );
  if (amount > 2_000_000_000) throw new Error("Enter a smaller amount.");
  return amount;
}

export function formatRateAmount(value: number, currency: string) {
  const decimals = moneyDecimals(currency);
  return (value / 10 ** decimals).toFixed(decimals);
}
