import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CarrierCart } from "./calculated-rates";

function key() {
  const secret = process.env.SHIPFLOW_CARRIER_KEY ?? "";
  if (!/^[\da-f]{64}$/i.test(secret))
    throw new Error(
      "Set SHIPFLOW_CARRIER_KEY on the app server before connecting Maps.",
    );
  return Buffer.from(secret, "hex");
}

export async function connectMaps(storeId: string, apiKey: string) {
  if (!/^[A-Za-z0-9_-]{20,160}$/.test(apiKey))
    throw new Error("Enter a Google Maps API key with Routes API access.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`maps:${storeId}`));
  const encrypted = Buffer.concat([cipher.update(apiKey), cipher.final()]);
  await routeDistance(
    apiKey,
    "101 California St, San Francisco, CA, US",
    "100 Broadway, Oakland, CA, US",
    6000,
  );
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
}

async function routeDistance(
  apiKey: string,
  origin: string,
  destination: string,
  timeout: number,
) {
  const signal = AbortSignal.timeout(timeout);
  try {
    const response = await fetch(
      "https://routes.googleapis.com/directions/v2:computeRoutes",
      {
        method: "POST",
        redirect: "error",
        signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: { address: origin },
          destination: { address: destination },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_UNAWARE",
        }),
      },
    );
    if (!response.ok)
      throw new Error(
        `Google Maps rejected the request (HTTP ${response.status}).`,
      );
    const data = await response.json();
    const route = data?.routes?.[0];
    if (!route) throw new Error("Google Maps could not find a driving route.");
    const meters = route.distanceMeters ?? 0;
    if (!Number.isSafeInteger(meters) || meters < 0)
      throw new Error("Google Maps returned an invalid route distance.");
    return meters as number;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Google Maps "))
      throw error;
    throw new Error(
      signal.aborted
        ? "Google Maps timed out."
        : "Google Maps was unavailable.",
    );
  }
}

export async function checkoutDistance(
  cart: CarrierCart,
  storeId: string,
  credentials?: string | null,
) {
  if (!credentials)
    return { error: "Connect Google Maps in Settings to calculate distance." };
  if (!cart.origin?.postalCode || !cart.postalCode)
    return {
      error:
        "Origin and destination postal codes are needed to calculate distance.",
    };
  let apiKey: string;
  try {
    const [iv, tag, encrypted] = credentials
      .split(".")
      .map((value) => Buffer.from(value, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAAD(Buffer.from(`maps:${storeId}`));
    decipher.setAuthTag(tag);
    apiKey = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString();
  } catch {
    return {
      error:
        "Google Maps credentials could not be read. Reconnect Maps in Settings.",
    };
  }
  const address = (
    country: string,
    province?: string | null,
    postal?: string,
    city?: string,
    street?: string,
  ) =>
    [street, city, province, postal, country]
      .filter(Boolean)
      .join(", ")
      .slice(0, 500);
  try {
    const meters = await routeDistance(
      apiKey,
      address(
        cart.origin.country,
        cart.origin.province,
        cart.origin.postalCode,
        cart.origin.city,
        cart.origin.street,
      ),
      address(
        cart.destination.country,
        cart.destination.province,
        cart.postalCode,
        cart.city,
        cart.customer?.address,
      ),
      1100,
    );
    return { meters };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
