import type { CarrierCart, PricingReason } from "./calculated-rates";

export const diagnosticsPaths = {
  simulator: "/app/simulator",
  history: "/app/history",
  request: (id: string) => `/app/history/${id}`,
  exportCustomerData: (id: string) => `/app/history/customer-data/${id}`,
};

export const historyDays = 30;
const day = 86_400_000;

export function historyCutoff(now = new Date()) {
  return new Date(now.getTime() - historyDays * day);
}

function dateOnly(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
    ? date
    : null;
}

export function historyFilterParams({
  search = "",
  from = "",
  to = "",
  page = 1,
}: {
  search?: string;
  from?: string;
  to?: string;
  page?: number;
} = {}) {
  const params = new URLSearchParams();
  const query = search.trim().slice(0, 120);
  if (query) params.set("q", query);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (page > 1) params.set("page", String(page));
  return params;
}

export function parseHistoryRange(value: string | undefined) {
  const [from = "", to = ""] = value?.split("--") ?? [];
  return { from, to, complete: Boolean(from && to) };
}

export function historyFilters(params: URLSearchParams, now = new Date()) {
  const cutoff = historyCutoff(now);
  const min = cutoff.toISOString().slice(0, 10);
  const max = now.toISOString().slice(0, 10);
  const search = (params.get("q") ?? "").trim().slice(0, 120);
  const rawFrom = dateOnly(params.get("from"))?.toISOString().slice(0, 10);
  const rawTo = dateOnly(params.get("to"))?.toISOString().slice(0, 10);
  const clamp = (date: string) => (date < min ? min : date > max ? max : date);
  const from = rawFrom ? clamp(rawFrom) : "";
  const to = rawTo ? clamp(rawTo) : "";
  const start = dateOnly(from);
  const end = dateOnly(to);
  const page = Number(params.get("page"));
  return {
    search,
    from,
    to,
    min,
    max,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    start: start && start > cutoff ? start : cutoff,
    end: end
      ? new Date(Math.min(end.getTime() + day, now.getTime() + 1))
      : new Date(now.getTime() + 1),
  };
}

export type CartSnapshot = {
  origin: CarrierCart["destination"] | null;
  destination: CarrierCart["destination"];
  locale: string | null;
  currency: string;
  subtotal: number;
  quantity: number;
  grams: number | null;
  lines: {
    variantId: string | null;
    name: string | null;
    price: number;
    quantity: number;
    grams: number | null;
  }[];
  extraLines: number;
};

export function cartSnapshot(cart: CarrierCart): CartSnapshot {
  return {
    origin: cart.origin
      ? { country: cart.origin.country, province: cart.origin.province }
      : null,
    destination: cart.destination,
    locale: cart.locale ?? null,
    currency: cart.currency,
    subtotal: cart.subtotal,
    quantity: cart.lines.reduce((sum, item) => sum + item.quantity, 0),
    grams: cart.lines.every((item) => item.grams !== null)
      ? cart.lines.reduce(
          (sum, item) => sum + (item.grams ?? 0) * item.quantity,
          0,
        )
      : null,
    lines: cart.lines.slice(0, 100).map((item) => ({
      variantId: item.variantId ?? null,
      name: item.name?.slice(0, 160) ?? null,
      price: item.price,
      quantity: item.quantity,
      grams: item.grams,
    })),
    extraLines: Math.max(0, cart.lines.length - 100),
  };
}

export const pricingReasonText: Record<PricingReason, string> = {
  "store-fallback":
    "No scenario priced this cart. ShipFlow returned the store fallback.",
  matched: "Shipping rates returned",
  "no-region":
    "No region matched the destination. Check the country and province or state.",
  "no-active-scenarios": "There were no active scenarios to evaluate.",
  "unmatched-conditions": "No scenario satisfied all of its conditions.",
  "no-region-rate": "A scenario matched, but it has no rates for this region.",
  "no-priced-rate":
    "A scenario matched, but none of its rates could be calculated.",
  "currency-mismatch":
    "The matching scenario or rate uses a different currency.",
  "no-match": "No eligible shipping rate was found.",
  "app-disabled": "ShipFlow is disabled in Settings.",
  "inactive-mode":
    "CCS Rates is inactive. Test Delivery Customization in a real checkout.",
  "test-mode": "Test Mode requires shipflow as the checkout first name.",
  "carrier-disabled":
    "Carrier Calculated Shipping was unavailable for this request.",
  "invalid-request":
    "The request was missing required shipping or cart information.",
  "evaluation-error":
    "ShipFlow received the request but could not evaluate it.",
};

export function formatPlace(
  place: { country: string; province: string | null } | null,
) {
  return (
    [place?.province, place?.country].filter(Boolean).join(", ") ||
    "Unavailable"
  );
}

export function historyCustomer(
  name: string | undefined,
  identity: string,
  customerId: string | null,
) {
  return (
    name ??
    (identity === "test"
      ? "Test checkout"
      : customerId
        ? "Shopify customer"
        : "Unavailable")
  );
}

export function historyTime(value: Date | string) {
  return (
    new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(value)) + " UTC"
  );
}
