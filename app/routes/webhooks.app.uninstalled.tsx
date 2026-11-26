import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await db.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { shop } });
    const store = await tx.store.findUnique({
      where: { shopDomain: shop },
      select: { id: true },
    });
    if (!store) return;
    await tx.store.update({
      where: { id: store.id },
      data: { carrierServiceId: null, ccsStatus: "UNKNOWN" },
    });
    await tx.carrierConnection.deleteMany({ where: { storeId: store.id } });
    await tx.storeSettings.updateMany({
      where: { storeId: store.id },
      data: { mapsCredentials: null },
    });
    await tx.catalogSync.updateMany({
      where: { storeId: store.id },
      data: {
        job: null,
        lease: null,
        leaseUntil: null,
        retryAt: null,
        startedAt: null,
        nextSyncAt: null,
      },
    });
    await tx.catalogProductChange.deleteMany({ where: { storeId: store.id } });
  });

  return new Response();
};
