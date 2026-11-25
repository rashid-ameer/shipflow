import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { runCatalogBatch, runCatalogChange } from "./catalog.server";

async function processCatalogWork() {
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO "CatalogSync" ("storeId", "nextSyncAt")
    SELECT s.id, ${now} FROM "Store" s
      JOIN "Session" a ON a.id = 'offline_' || s."shopDomain"
      WHERE s."onboardingStep" = 'COMPLETE'
    ON CONFLICT ("storeId") DO NOTHING
  `;
  await prisma.$executeRaw`
    UPDATE "CatalogSync" c SET job = 'catalog', "startedAt" = ${now},
      "productCursor" = 0, processed = 0, rejected = 0, attempts = 0, error = NULL, "retryAt" = NULL
    FROM "Store" s JOIN "Session" a ON a.id = 'offline_' || s."shopDomain"
    WHERE c."storeId" = s.id AND c."autoSync" AND c.job IS NULL
      AND (c."nextSyncAt" IS NULL OR c."nextSyncAt" <= ${now})
  `;
  const jobs = await prisma.$queryRaw<
    { storeId: string; shopDomain: string }[]
  >`
    SELECT c."storeId", s."shopDomain" FROM "CatalogSync" c
      JOIN "Store" s ON s.id = c."storeId" JOIN "Session" a ON a.id = 'offline_' || s."shopDomain"
    WHERE c.job IS NOT NULL AND (c."leaseUntil" IS NULL OR c."leaseUntil" <= ${now})
      AND (c."retryAt" IS NULL OR c."retryAt" <= ${now})
    ORDER BY c."startedAt", c."storeId" LIMIT 5
  `;
  const changes = await prisma.$queryRaw<
    {
      storeId: string;
      shopDomain: string;
      productId: bigint;
      revision: string;
    }[]
  >`
    SELECT p."storeId", p."productId", p.revision, s."shopDomain" FROM "CatalogProductChange" p
      JOIN "Store" s ON s.id = p."storeId" JOIN "Session" a ON a.id = 'offline_' || s."shopDomain"
      LEFT JOIN "CatalogSync" c ON c."storeId" = p."storeId"
    WHERE p."dueAt" <= ${now} AND c.job IS NULL
    ORDER BY p."dueAt" LIMIT 10
  `;
  const graphql = (shop: string) => async () =>
    (await unauthenticated.admin(shop)).admin.graphql;
  await Promise.all([
    ...jobs.map((job) => runCatalogBatch(job.storeId, graphql(job.shopDomain))),
    ...changes.map((change) =>
      runCatalogChange(change, graphql(change.shopDomain)),
    ),
  ]);
  return jobs.length > 0 || changes.length > 0;
}

type Loop = { run: typeof processCatalogWork };
const runtime = globalThis as typeof globalThis & {
  shipflowCatalogWorker?: Loop;
};

export function startCatalogWorker() {
  if (process.env.NODE_ENV === "test" || !process.env.DATABASE_URL) return;
  if (runtime.shipflowCatalogWorker) {
    runtime.shipflowCatalogWorker.run = processCatalogWork;
    return;
  }
  const loop: Loop = { run: processCatalogWork };
  runtime.shipflowCatalogWorker = loop;
  const tick = async () => {
    let busy = false;
    try {
      busy = await loop.run();
    } catch {
      console.error("ShipFlow could not advance catalog sync jobs.");
    }
    setTimeout(tick, busy ? 1_500 : 15_000).unref();
  };
  setTimeout(tick, 1_500).unref();
}
