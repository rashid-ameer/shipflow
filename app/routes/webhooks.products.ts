import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { catalogId } from "../models/catalog-shopify.server";
import { queueCatalogProduct } from "../models/catalog.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload, session } = await authenticate.webhook(request);
  if (!session) return new Response();
  const gid =
    typeof payload.admin_graphql_api_id === "string"
      ? payload.admin_graphql_api_id
      : "";
  const id = catalogId(
    gid.startsWith("gid://shopify/Product/")
      ? gid.split("/").at(-1)
      : payload.id,
  );
  const store =
    id &&
    (await prisma.store.findUnique({
      where: { shopDomain: shop },
      select: { id: true },
    }));
  if (id && store) await queueCatalogProduct(store.id, id);
  return new Response();
}
