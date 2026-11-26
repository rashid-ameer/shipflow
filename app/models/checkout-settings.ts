import { parseDecimal, parseMoney, textValue } from "./checkout-values";

export type DistanceUnit = "km" | "mi";
export const distanceUnits = { km: 1000, mi: 1609.344 } as const;
export function distanceUnit(value: unknown): DistanceUnit {
  return value === "mi" ? "mi" : "km";
}

export const dateFormats = [
  "MM/DD/YYYY",
  "DD/MM/YYYY",
  "YYYY/MM/DD",
  "YYYY/DD/MM",
  "MM-DD-YYYY",
  "DD-MM-YYYY",
  "YYYY-MM-DD",
  "YYYY-DD-MM",
  "custom",
] as const;
export const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type Appearance = {
  label: string;
  precise: boolean;
  format: (typeof dateFormats)[number];
  custom: string;
  excluded: number[];
};
export const defaultAppearance: Appearance = {
  label: "business days",
  precise: true,
  format: "MM/DD/YYYY",
  custom: "YYYY-MM-DD",
  excluded: [0, 6],
};

export type ShippingConfiguration = {
  preventDoubling: boolean;
  ukPostal: boolean;
  manualCodes: boolean;
  fallback?: {
    name: string;
    description: string;
    kind: "fixed" | "percent";
    value: string;
    currency: string;
  };
};
export const defaultShipping: ShippingConfiguration = {
  preventDoubling: false,
  ukPostal: false,
  manualCodes: false,
};

export function validateAppearance(form: FormData): Appearance {
  const label = textValue(form.get("label")) || defaultAppearance.label;
  const format = textValue(form.get("format")) as Appearance["format"];
  const custom = textValue(form.get("custom")) || defaultAppearance.custom;
  const excluded = [
    ...new Set(
      form
        .getAll("excluded")
        .map((day) => (/^\d$/.test(String(day)) ? Number(day) : -1)),
    ),
  ].sort();
  if (label.length > 50 || !dateFormats.includes(format))
    throw new Error(
      "Use up to 50 characters in the business-days label and choose a date format.",
    );
  if (excluded.length > 6 || excluded.some((day) => day < 0 || day > 6))
    throw new Error("Leave at least one delivery weekday available.");
  if (
    format === "custom" &&
    (!/^(?:YYYY|MM|DD|[ /.-])+$/u.test(custom) ||
      !["YYYY", "MM", "DD"].every((part) => custom.split(part).length === 2) ||
      custom.length > 24)
  )
    throw new Error(
      "Use YYYY, MM, and DD once each, with spaces, dots, slashes, or dashes.",
    );
  return {
    label,
    format,
    custom: format === "custom" ? custom : defaultAppearance.custom,
    excluded,
    precise: form.get("precise") === "true",
  };
}

export function validateShippingConfiguration(
  form: FormData,
  currency?: string,
): ShippingConfiguration {
  const config: ShippingConfiguration = {
    preventDoubling: form.get("preventDoubling") === "true",
    ukPostal: form.get("ukPostal") === "true",
    manualCodes: form.get("manualCodes") === "true",
  };
  if (form.get("fallbackEnabled") !== "true") return config;
  const name = textValue(form.get("fallbackName"));
  const description = textValue(form.get("fallbackDescription"));
  const kind = form.get("fallbackKind");
  const value = textValue(form.get("fallbackValue"));
  if (!currency || !/^[A-Z]{3}$/.test(currency))
    throw new Error("Shopify store currency is unavailable.");
  if (
    !name ||
    name.length > 120 ||
    description.length > 250 ||
    (kind !== "fixed" && kind !== "percent")
  )
    throw new Error("Enter a fallback name, description, and price type.");
  if (kind === "fixed") parseMoney(value, currency);
  else if (parseDecimal(value, 3) > 1000)
    throw new Error("Use a fallback percentage at or below 1,000%.");
  return { ...config, fallback: { name, description, kind, value, currency } };
}

export function validateRateCode(input: unknown) {
  const code = textValue(input);
  if (!code) return null;
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(code) || /^shipflow-/i.test(code))
    throw new Error(
      "Use up to 48 letters, numbers, underscores, or dashes. The shipflow- prefix is reserved.",
    );
  return code;
}

export function deliveryDays(input: unknown) {
  if (input == null || input === "") return null;
  const value = typeof input === "number" ? String(input) : textValue(input);
  if (!/^\d{1,3}$/.test(value) || Number(value) > 365)
    throw new Error("Enter delivery estimates from 0 to 365 days.");
  return Number(value);
}

export function deliveryEstimate(
  min: number | null | undefined,
  max: number | null | undefined,
  appearance: Appearance,
  timezone: string,
  now: Date,
) {
  if (min == null && max == null) return null;
  let today: string[];
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    today = ["year", "month", "day"].map(
      (type) => parts.find((part) => part.type === type)!.value,
    );
  } catch {
    today = now.toISOString().slice(0, 10).split("-");
  }
  const calendarDate = (days: number) => {
    const date = new Date(
      Date.UTC(Number(today[0]), Number(today[1]) - 1, Number(today[2])),
    );
    const excluded = new Set(appearance.excluded);
    if (excluded.size >= 7) return date.toISOString().slice(0, 10);
    while (days || excluded.has(date.getUTCDay())) {
      date.setUTCDate(date.getUTCDate() + 1);
      if (days && !excluded.has(date.getUTCDay())) days--;
    }
    return date.toISOString().slice(0, 10);
  };
  const range = (left: string, right: string) =>
    left === right ? left : `${left} – ${right}`;
  if (!appearance.precise)
    return {
      text: `${range(String(min ?? max), String(max ?? min))} ${appearance.label}`,
    };
  const start = calendarDate(min ?? max!);
  const end = calendarDate(max ?? min!);
  const format =
    appearance.format === "custom" ? appearance.custom : appearance.format;
  const label = (date: string) => {
    const [YYYY, MM, DD] = date.split("-");
    return format.replace(/YYYY|MM|DD/g, (token) => ({ YYYY, MM, DD })[token]!);
  };
  const deliveryDate = (date: string) => {
    let offset = "+0000";
    try {
      const zone = new Intl.DateTimeFormat("en", {
        timeZone: timezone,
        timeZoneName: "longOffset",
      });
      offset =
        zone
          .formatToParts(new Date(`${date}T12:00:00Z`))
          .find(({ type }) => type === "timeZoneName")
          ?.value.match(/GMT([+-]\d{2}):(\d{2})/)
          ?.slice(1)
          .join("") ?? offset;
    } catch {
      // A previously saved time zone can become unavailable after an upgrade.
    }
    return `${date} 12:00:00 ${offset}`;
  };
  return {
    text: range(label(start), label(end)),
    min: deliveryDate(start),
    max: deliveryDate(end),
  };
}
