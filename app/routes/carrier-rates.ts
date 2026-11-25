import type { ActionFunctionArgs } from "react-router";
import { validCarrierCallback } from "../models/carrier-shopify.server";
import {
  evaluateStoreCart,
  getPricingStore,
} from "../models/checkout-pricing.server";
import { recordCarrierRequest } from "../models/checkout-history.server";
import {
  normalizeCarrierPayload,
  type CarrierCart,
  type PricingResult,
} from "../models/calculated-rates";

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
  let cart: CarrierCart | null = null;
  let connected = false;
  async function reply(result: PricingResult, status = 200) {
    if (connected) await recordCarrierRequest(id, cart, result, status);
    return Response.json({ rates: result.rates }, { status, headers });
  }
  try {
    const shop = await getPricingStore(id);
    if (!shop?.carrierServiceId)
      return Response.json({ rates: [] }, { status: 401, headers });
    connected = true;
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return reply({ rates: [], reason: "invalid-request", trace: null }, 415);
    cart = await readCart(request).catch(() => null);
    if (!cart)
      return reply({ rates: [], reason: "invalid-request", trace: null }, 400);
    return reply(
      await evaluateStoreCart(shop, cart, {
        simulation: false,
        getGraphql: async () => {
          const { unauthenticated } = await import("../shopify.server");
          return (await unauthenticated.admin(shop.shopDomain)).admin.graphql;
        },
      }),
    );
  } catch {
    console.warn(
      "ShipFlow could not calculate rates for a Carrier Service request.",
    );
    return reply({ rates: [], reason: "evaluation-error", trace: null }, 500);
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
