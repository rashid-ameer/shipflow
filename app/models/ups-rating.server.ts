import { randomUUID } from "node:crypto";
import { parseMoney } from "./checkout-values";
import type { CarrierQuote } from "./live-carrier";

export type UpsCredentials = {
  clientId: string;
  clientSecret: string;
  account: string;
  environment: "sandbox" | "production";
};
export type ShipAddress = {
  country: string;
  postalCode: string;
  province?: string | null;
  city?: string;
};
export type Parcel = { grams: number; cm: [number, number, number] };

export class CarrierFailure extends Error {}

const serviceNames: Record<string, string> = {
  "01": "Next Day Air",
  "02": "2nd Day Air",
  "03": "Ground",
  "07": "Worldwide Express",
  "08": "Worldwide Expedited",
  "11": "Standard",
  "12": "3 Day Select",
  "13": "Next Day Air Saver",
  "14": "Next Day Air Early",
  "54": "Worldwide Express Plus",
  "59": "2nd Day Air A.M.",
  "65": "Worldwide Saver",
  "70": "Access Point Economy",
  "92": "Ground Saver",
  "96": "Worldwide Express Freight",
  "71": "Worldwide Express Freight Midday",
};

const tokens = new Map<string, { value: string; expires: number }>();
const pending = new Map<string, Promise<string>>();

async function requestJson(url: string, init: RequestInit, stage: string) {
  try {
    const response = await fetch(url, { ...init, redirect: "error" });
    if (!response.ok) {
      const reason =
        response.status === 401 || response.status === 403
          ? "authorization failed"
          : response.status === 429
            ? "request limit reached"
            : response.status < 500
              ? "request rejected"
              : "service unavailable";
      throw new CarrierFailure(
        `UPS ${stage}: ${reason} (HTTP ${response.status}).`,
      );
    }
    return await response.json();
  } catch (error) {
    if (error instanceof CarrierFailure) throw error;
    throw new CarrierFailure(
      init.signal?.aborted
        ? `UPS ${stage} timed out.`
        : `UPS ${stage} could not be completed.`,
    );
  }
}

async function accessToken(
  base: string,
  auth: UpsCredentials,
  signal: AbortSignal,
  key?: string,
) {
  const cached = key && tokens.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const inflight = key && pending.get(key);
  if (inflight) return inflight;
  const load = async () => {
    const response = await requestJson(
      `${base}/security/v1/oauth/token`,
      {
        method: "POST",
        signal,
        headers: {
          Authorization: `Basic ${Buffer.from(`${auth.clientId}:${auth.clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "x-merchant-id": auth.account,
        },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
      },
      "authentication",
    );
    if (typeof response?.access_token !== "string" || !response.access_token)
      throw new CarrierFailure("UPS returned an invalid access token.");
    const lifetime = Number(response.expires_in);
    if (key && Number.isFinite(lifetime) && lifetime > 60) {
      if (tokens.size >= 256) tokens.delete(tokens.keys().next().value!);
      tokens.set(key, {
        value: response.access_token,
        expires: Date.now() + (Math.min(lifetime, 14400) - 60) * 1000,
      });
    }
    return response.access_token as string;
  };
  if (!key) return load();
  const work = load();
  pending.set(key, work);
  try {
    return await work;
  } finally {
    pending.delete(key);
  }
}

export async function quoteUps(
  auth: UpsCredentials,
  origin: ShipAddress,
  destination: ShipAddress,
  parcels: Parcel[],
  signal: AbortSignal,
  key?: string,
): Promise<CarrierQuote[]> {
  const base =
    auth.environment === "sandbox"
      ? "https://wwwcie.ups.com"
      : "https://onlinetools.ups.com";
  const token = await accessToken(base, auth, signal, key);
  if (signal.aborted) throw new CarrierFailure("UPS rating timed out.");
  const imperial = origin.country === "US";
  const measure = (value: number) => String(Math.ceil(value * 10) / 10);
  const address = (input: ShipAddress) => ({
    CountryCode: input.country,
    PostalCode: input.postalCode,
    ...(input.province ? { StateProvinceCode: input.province } : {}),
    ...(input.city ? { City: input.city } : {}),
  });
  const response = await requestJson(
    `${base}/api/rating/v2409/Shop`,
    {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        transId: randomUUID().replaceAll("-", ""),
        transactionSrc: "ShipFlow",
      },
      body: JSON.stringify({
        RateRequest: {
          Request: {
            RequestOption: "Shop",
            TransactionReference: { CustomerContext: "ShipFlow" },
          },
          Shipment: {
            Shipper: { ShipperNumber: auth.account, Address: address(origin) },
            ShipFrom: { Address: address(origin) },
            ShipTo: { Address: address(destination) },
            PaymentDetails: {
              ShipmentCharge: [
                { Type: "01", BillShipper: { AccountNumber: auth.account } },
              ],
            },
            NumOfPieces: String(parcels.length),
            ShipmentRatingOptions: { NegotiatedRatesIndicator: "Y" },
            Package: parcels.map(({ grams, cm }) => ({
              PackagingType: { Code: "02" },
              Dimensions: {
                UnitOfMeasurement: { Code: imperial ? "IN" : "CM" },
                Length: measure(cm[0] / (imperial ? 2.54 : 1)),
                Width: measure(cm[1] / (imperial ? 2.54 : 1)),
                Height: measure(cm[2] / (imperial ? 2.54 : 1)),
              },
              PackageWeight: {
                UnitOfMeasurement: { Code: imperial ? "LBS" : "KGS" },
                Weight: measure(grams / (imperial ? 453.59237 : 1000)),
              },
            })),
          },
        },
      }),
    },
    "rating",
  );
  const rated = response?.RateResponse?.RatedShipment;
  const shipments = Array.isArray(rated) ? rated : rated ? [rated] : [];
  const quotes = new Map<string, CarrierQuote>();
  for (const shipment of shipments) {
    const code = shipment?.Service?.Code;
    const total =
      shipment?.NegotiatedRateCharges?.TotalCharge ?? shipment?.TotalCharges;
    const currency = total?.CurrencyCode;
    if (
      typeof code !== "string" ||
      !/^\d{2,3}$/.test(code) ||
      typeof currency !== "string" ||
      !/^[A-Z]{3}$/.test(currency) ||
      typeof total?.MonetaryValue !== "string"
    )
      continue;
    const decimal = total.MonetaryValue.replace(/(\.\d*?)0+$/, "$1").replace(
      /\.$/,
      "",
    );
    let amount: number;
    try {
      amount = parseMoney(decimal, currency);
    } catch {
      continue;
    }
    const description = shipment.Service.Description;
    const name =
      typeof description === "string" && description.trim()
        ? description.trim().slice(0, 120)
        : `UPS ${serviceNames[code] ?? `Service ${code}`}`;
    if (!quotes.has(code) || amount < quotes.get(code)!.amount)
      quotes.set(code, { code, name, currency, amount });
  }
  if (!quotes.size)
    throw new CarrierFailure("UPS returned no usable shipping quotes.");
  return [...quotes.values()];
}
