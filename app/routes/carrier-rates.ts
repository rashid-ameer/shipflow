import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  checkoutBlockReason,
  type CheckoutDecisionInput,
} from "../models/checkout-decision";
import { validCarrierCallback } from "../models/carrier-shopify.server";
import { loadActivePricing } from "../models/calculated-rates.server";
import {
  evaluateCarrierCart,
  normalizeCarrierPayload,
  testIdentity,
} from "../models/calculated-rates";
import {
  MULTIPLE_RATE_BEHAVIORS,
  ROUNDING_METHODS,
} from "../models/shipping-settings";

const maxRequestLength = 256 * 1024;
const headers = { "Cache-Control": "no-store" };

export function loader() {
  return new Response(null, {
    status: 405,
    headers: { ...headers, Allow: "POST" },
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") return loader();
  const id = params.storeId ?? "";
  if (
    !validCarrierCallback(
      id,
      params.signature ?? "",
      process.env.SHOPIFY_API_SECRET,
    )
  ) {
    return Response.json({ rates: [] }, { status: 401, headers });
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return Response.json({ rates: [] }, { status: 415, headers });
  }
  const cart = await readCart(request).catch(() => null);
  if (!cart) return Response.json({ rates: [] }, { status: 400, headers });

  try {
    const shop = await prisma.store.findUnique({
      where: { id },
      select: {
        mode: true,
        appEnabled: true,
        testMode: true,
        ccsStatus: true,
        carrierServiceId: true,
        settings: { select: { multipleRates: true, rounding: true } },
      },
    });
    if (!shop?.carrierServiceId)
      return Response.json({ rates: [] }, { status: 401, headers });
    const multipleRates =
      MULTIPLE_RATE_BEHAVIORS.find(
        (item) => item === shop.settings?.multipleRates,
      ) ?? "all";
    const rounding =
      ROUNDING_METHODS.find((item) => item === shop.settings?.rounding) ??
      "none";
    const settings: CheckoutDecisionInput = {
      mode:
        shop.mode === "CCS_RATES"
          ? "ccs-rates"
          : shop.mode === "DELIVERY_CUSTOMIZATION"
            ? "delivery-customization"
            : null,
      appEnabled: shop.appEnabled,
      testMode: shop.testMode,
      customerFirstName: cart.firstName,
      multipleRates,
      rounding,
    };
    const blocked =
      checkoutBlockReason(settings) ??
      (shop.ccsStatus !== "ENABLED" ? "carrier-disabled" : null);
    const result = blocked
      ? { rates: [], reason: blocked }
      : await loadActivePricing(id).then(({ regions, scenarios }) =>
          evaluateCarrierCart(cart, settings, regions, scenarios),
        );
    await prisma.carrierRequest
      .create({
        data: {
          storeId: id,
          country: cart.destination.country,
          province: cart.destination.province,
          currency: cart.currency,
          testIdentity: testIdentity(cart),
          reason: result.reason,
          rateCount: result.rates.length,
        },
      })
      .catch(() =>
        console.warn("ShipFlow could not save carrier request diagnostics."),
      );
    return Response.json({ rates: result.rates }, { headers });
  } catch {
    console.warn(
      "ShipFlow could not calculate rates for a Carrier Service request.",
    );
    return Response.json({ rates: [] }, { headers });
  }
}

async function readCart(request: Request) {
  if (
    !request.body ||
    Number(request.headers.get("content-length")) > maxRequestLength
  )
    return null;
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maxRequestLength) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return normalizeCarrierPayload(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
}
