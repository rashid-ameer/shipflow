import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "./shop-settings.server";

export async function requireRatesStore(request: Request, mutation = false) {
  const { admin, session } = await authenticate.admin(request);
  const store = await getOrCreateShop(session.shop);
  if (store.mode !== "CCS_RATES" || store.onboardingStep !== "COMPLETE") {
    if (mutation)
      throw new Response("Select CCS Rates before editing shipping rates.", {
        status: 409,
      });
    throw redirect("/app");
  }
  return { admin, store };
}
