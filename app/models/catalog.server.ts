import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import {
  asDimensionUnit,
  catalogLimit,
  dimensionAxes,
  metafieldDimension,
  readDimensionMapping,
  type DimensionMapping,
  type Dimensions,
} from "./product-dimensions";
import {
  resourceId,
  shopifyCatalogPage,
  shopifyCatalogProduct,
  shopifyDimensionFields,
} from "./catalog-shopify.server";
import type { AdminQuery } from "./delivery-customization-admin.server";

type Transaction = Prisma.TransactionClient;
type Product = NonNullable<Awaited<ReturnType<typeof shopifyCatalogProduct>>>;
const day = 86_400_000;
const afterDay = (now: Date) => new Date(now.getTime() + day);

async function lockCatalog(tx: Transaction, storeId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"catalog:" + storeId}))::text`;
}

export async function requestCatalogSync(
  storeId: string,
  unit: string,
  mapping?: DimensionMapping,
) {
  if (mapping && !Object.values(mapping).some(({ key }) => key))
    throw new Error("Map at least one length, width, or height metafield.");
  return prisma.$transaction(async (tx) => {
    await lockCatalog(tx, storeId);
    const current = await tx.catalogSync.findUnique({ where: { storeId } });
    if (current?.job && !current.error)
      throw new Error("A sync is already in progress.");
    const data = {
      job: mapping ? "metafields" : "catalog",
      startedAt: new Date(),
      productCursor: 0n,
      processed: 0,
      rejected: 0,
      error: null,
      attempts: 0,
      retryAt: null,
      lease: null,
      leaseUntil: null,
      ...(mapping ? { mapping, mappingUnit: unit } : {}),
    };
    return tx.catalogSync.upsert({
      where: { storeId },
      create: { storeId, ...data },
      update: data,
    });
  });
}

export async function setCatalogAutoSync(storeId: string, autoSync: boolean) {
  await prisma.catalogSync.upsert({
    where: { storeId },
    create: { storeId, autoSync, nextSyncAt: autoSync ? new Date() : null },
    update: { autoSync, nextSyncAt: autoSync ? afterDay(new Date()) : null },
  });
}

export async function queueCatalogProduct(storeId: string, productId: bigint) {
  const revision = crypto.randomUUID();
  const dueAt = new Date();
  await prisma.catalogProductChange.upsert({
    where: { storeId_productId: { storeId, productId } },
    update: { revision, dueAt },
    create: { storeId, productId, revision, dueAt },
  });
}

export async function saveCatalogProducts(
  tx: Transaction,
  storeId: string,
  products: Product[],
  seenAt: Date,
) {
  if (!products.length) return;
  const rows = products.map((product) => ({
    id: resourceId(product.id).toString(),
    title: product.title,
    tags: product.tags,
    searchTags: product.tags.join("\n"),
    productType: product.productType,
    vendor: product.vendor,
  }));
  const variants = products.flatMap((product, index) =>
    product.allVariants.map((variant) => ({
      id: resourceId(variant.id).toString(),
      productId: rows[index].id,
      title: variant.title,
      sku: variant.sku ?? "",
      barcode: variant.barcodes.nodes[0]?.value ?? "",
    })),
  );
  await tx.$executeRaw`
    INSERT INTO "CatalogProduct" ("storeId", "id", "title", "tags", "searchTags", "productType", "vendor", "seenAt")
    SELECT ${storeId}, p.id, p.title, p.tags, p."searchTags", p."productType", p.vendor, ${seenAt}
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
        AS p(id bigint, title text, tags text[], "searchTags" text, "productType" text, vendor text)
    ON CONFLICT ("storeId", "id") DO UPDATE SET "title" = excluded."title", "tags" = excluded."tags",
      "searchTags" = excluded."searchTags", "productType" = excluded."productType", "vendor" = excluded."vendor",
      "seenAt" = excluded."seenAt"
  `;
  await tx.$executeRaw`
    INSERT INTO "CatalogVariant" ("storeId", "id", "productId", "title", "sku", "barcode")
    SELECT ${storeId}, v.id, v."productId", v.title, v.sku, v.barcode
      FROM jsonb_to_recordset(${JSON.stringify(variants)}::jsonb)
        AS v(id bigint, "productId" bigint, title text, sku text, barcode text)
    ON CONFLICT ("storeId", "id") DO UPDATE SET "productId" = excluded."productId",
      "title" = excluded."title", "sku" = excluded."sku", "barcode" = excluded."barcode"
  `;
  await tx.$executeRaw`
    DELETE FROM "CatalogVariant" v WHERE v."storeId" = ${storeId}
      AND v."productId" = ANY (${rows.map(({ id }) => id)}::bigint[])
      AND NOT (v.id = ANY (${variants.map(({ id }) => id)}::bigint[]))
  `;
}

export async function updateCatalogDimensions(
  tx: Transaction,
  storeId: string,
  entries: { id: bigint; dimensions: Partial<Dimensions>; revision?: number }[],
) {
  if (!entries.length) return 0;
  const records = entries.map(({ id, dimensions, revision }) => ({
    id: id.toString(),
    dimensions,
    revision,
  }));
  return tx.$executeRaw`
    UPDATE "CatalogVariant" v SET
      "length" = CASE WHEN r.dimensions ? 'length' THEN (r.dimensions->>'length')::double precision ELSE v."length" END,
      "width" = CASE WHEN r.dimensions ? 'width' THEN (r.dimensions->>'width')::double precision ELSE v."width" END,
      "height" = CASE WHEN r.dimensions ? 'height' THEN (r.dimensions->>'height')::double precision ELSE v."height" END,
      "revision" = v."revision" + 1
    FROM jsonb_to_recordset(${JSON.stringify(records)}::jsonb) AS r(id bigint, dimensions jsonb, revision integer)
    WHERE v."storeId" = ${storeId} AND v.id = r.id AND (r.revision IS NULL OR v."revision" = r.revision)
  `;
}

export async function runCatalogBatch(
  storeId: string,
  graphql: () => Promise<AdminQuery>,
) {
  const now = new Date();
  const lease = crypto.randomUUID();
  const claim = await prisma.catalogSync.updateMany({
    where: {
      storeId,
      job: { not: null },
      AND: [
        { OR: [{ retryAt: null }, { retryAt: { lte: now } }] },
        { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      ],
    },
    data: { lease, leaseUntil: new Date(now.getTime() + 120_000) },
  });
  if (!claim.count) return false;
  const state = await prisma.catalogSync.findFirst({
    where: { storeId, lease },
  });
  if (!state) return false;
  try {
    const admin = await graphql();
    if (state.job === "catalog") {
      const next = await shopifyCatalogPage(
        admin,
        state.productCursor,
        Math.min(25, catalogLimit - state.processed),
      );
      if (next.more && !next.scanned)
        throw new Error("The Shopify catalog cursor could not advance.");
      await prisma.$transaction(
        async (tx) => {
          await lockCatalog(tx, storeId);
          if (!(await tx.catalogSync.findFirst({ where: { storeId, lease } })))
            return;
          await saveCatalogProducts(tx, storeId, next.items, state.startedAt!);
          const processed = state.processed + next.scanned;
          const done = !next.more || processed >= catalogLimit;
          if (done)
            await tx.catalogProduct.deleteMany({
              where: { storeId, seenAt: { lt: state.startedAt! } },
            });
          await tx.catalogSync.update({
            where: { storeId },
            data: {
              processed,
              productCursor: next.cursor,
              lease: null,
              leaseUntil: null,
              attempts: 0,
              error: null,
              retryAt: null,
              ...(done
                ? {
                    job: null,
                    lastSyncAt: now,
                    limitReached: next.more,
                    nextSyncAt: afterDay(now),
                  }
                : {}),
            },
          });
        },
        { timeout: 20_000 },
      );
    } else {
      const mapping = readDimensionMapping(state.mapping);
      const variants = await prisma.catalogVariant.findMany({
        where: { storeId, id: { gt: state.productCursor } },
        orderBy: { id: "asc" },
        take: 50,
        select: { id: true, revision: true },
      });
      const fields = variants.length
        ? await shopifyDimensionFields(
            admin,
            variants.map(({ id }) => id),
            mapping,
          )
        : new Map();
      const entries = variants.flatMap(({ id, revision }) => {
        const row = fields.get(id);
        if (!row) return [];
        const dimensions: Partial<Dimensions> = {};
        for (const axis of dimensionAxes) {
          const { namespace, key, owner } = mapping[axis];
          const source = owner === "variant" ? row : row.product;
          const raw = source.metafields?.nodes.find(
            (field: { namespace: string; key: string }) =>
              (field.namespace === namespace && field.key === key) ||
              field.key === `${namespace}.${key}`,
          );
          const size = metafieldDimension(
            raw,
            asDimensionUnit(state.mappingUnit),
          );
          if (size !== undefined) dimensions[axis] = size;
        }
        return Object.keys(dimensions).length
          ? [{ id, revision, dimensions }]
          : [];
      });
      await prisma.$transaction(async (tx) => {
        await lockCatalog(tx, storeId);
        if (!(await tx.catalogSync.findFirst({ where: { storeId, lease } })))
          return;
        const updated = await updateCatalogDimensions(tx, storeId, entries);
        await tx.catalogSync.update({
          where: { storeId },
          data: {
            productCursor: variants.at(-1)?.id ?? state.productCursor,
            processed: { increment: updated },
            rejected: { increment: variants.length - updated },
            lease: null,
            leaseUntil: null,
            attempts: 0,
            error: null,
            retryAt: null,
            ...(variants.length < 50
              ? { job: null, lastMetafieldSyncAt: now }
              : {}),
          },
        });
      });
    }
  } catch {
    const attempts = state.attempts + 1;
    await prisma.catalogSync.updateMany({
      where: { storeId, lease },
      data: {
        error:
          attempts >= 3
            ? "Sync failed. Run the sync again to retry."
            : "Sync paused. ShipFlow will retry.",
        attempts,
        lease: null,
        leaseUntil: null,
        retryAt:
          attempts >= 3 ? null : new Date(now.getTime() + 45_000 * attempts),
        ...(attempts >= 3
          ? {
              job: null,
              ...(state.job === "catalog" ? { nextSyncAt: afterDay(now) } : {}),
            }
          : {}),
      },
    });
  }
  return true;
}

export async function runCatalogChange(
  change: { storeId: string; productId: bigint; revision: string },
  graphql: () => Promise<AdminQuery>,
) {
  const { storeId, productId, revision } = change;
  try {
    const product = await shopifyCatalogProduct(await graphql(), productId);
    return await prisma.$transaction(
      async (tx) => {
        await lockCatalog(tx, storeId);
        const current = await tx.catalogProductChange.findFirst({
          where: { storeId, productId, revision },
        });
        if (!current) return;
        if (
          await tx.catalogSync.findFirst({
            where: { storeId, job: { not: null } },
          })
        ) {
          await tx.catalogProductChange.updateMany({
            where: { storeId, productId, revision },
            data: { dueAt: new Date(Date.now() + 60_000) },
          });
          return;
        }
        const exists = await tx.catalogProduct.findUnique({
          where: { storeId_id: { storeId, id: productId } },
        });
        if (
          product &&
          (exists ||
            (await tx.catalogProduct.count({ where: { storeId } })) <
              catalogLimit)
        )
          await saveCatalogProducts(tx, storeId, [product], new Date());
        if (!product && exists)
          await tx.catalogProduct.delete({
            where: { storeId_id: { storeId, id: productId } },
          });
        await tx.catalogProductChange.deleteMany({
          where: { storeId, productId, revision },
        });
      },
      { timeout: 20_000 },
    );
  } catch {
    await prisma.catalogProductChange.updateMany({
      where: { storeId, productId, revision },
      data: { dueAt: new Date(Date.now() + 300_000) },
    });
  }
}
