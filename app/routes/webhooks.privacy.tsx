import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop } = await authenticate.webhook(request);
  switch (topic) {
    case "SHOP_REDACT":
      await db.session.deleteMany({ where: { shop } });
      break;
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // The scaffold stores merchant sessions only. Extend these handlers
      // when a feature persists shopper data (for example, checkout history).
      break;
    default:
      return new Response(null, { status: 400 });
  }
  return new Response(null, { status: 200 });
}
