import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { positiveShopifyId } from "../models/calculated-rates";
import { historyCustomerExport } from "../models/checkout-history.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const id = positiveShopifyId(params.id);
  const exportData = id ? await historyCustomerExport(session.shop, id) : null;
  const headers = { "Cache-Control": "private, no-store" };
  if (!exportData) return new Response(null, { status: 404, headers });
  return Response.json(exportData, { headers });
}
