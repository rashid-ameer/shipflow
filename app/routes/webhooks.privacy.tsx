import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { positiveShopifyId } from "../models/calculated-rates";
import { recordHistoryDataRequest } from "../models/checkout-history.server";

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, payload } = await authenticate.webhook(request);
  switch (topic) {
    case "SHOP_REDACT":
      await db.$transaction([
        db.session.deleteMany({ where: { shop } }),
        db.carrierRequest.deleteMany({
          where: { store: { shopDomain: shop } },
        }),
        db.historyDataRequest.deleteMany({
          where: { store: { shopDomain: shop } },
        }),
      ]);
      break;
    case "CUSTOMERS_REDACT": {
      const customerId = positiveShopifyId(payload?.customer?.id);
      if (customerId)
        await db.$transaction([
          db.carrierRequest.deleteMany({
            where: { customerId, store: { shopDomain: shop } },
          }),
          db.historyDataRequest.deleteMany({
            where: { customerId, store: { shopDomain: shop } },
          }),
        ]);
      break;
    }
    case "CUSTOMERS_DATA_REQUEST": {
      const customerId = positiveShopifyId(payload?.customer?.id);
      const requestId = positiveShopifyId(payload?.data_request?.id);
      if (customerId && requestId)
        await recordHistoryDataRequest(shop, requestId, customerId);
      break;
    }
    default:
      return new Response(null, { status: 400 });
  }
  return new Response(null, { status: 200 });
}
