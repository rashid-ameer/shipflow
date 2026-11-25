-- CreateTable
CREATE TABLE "CatalogProduct" (
    "storeId" TEXT NOT NULL,
    "id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "tags" TEXT[],
    "searchTags" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogProduct_pkey" PRIMARY KEY ("storeId","id")
);

-- CreateTable
CREATE TABLE "CatalogVariant" (
    "storeId" TEXT NOT NULL,
    "id" BIGINT NOT NULL,
    "productId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "length" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CatalogVariant_pkey" PRIMARY KEY ("storeId","id")
);

-- CreateTable
CREATE TABLE "CatalogSync" (
    "storeId" TEXT NOT NULL,
    "autoSync" BOOLEAN NOT NULL DEFAULT true,
    "nextSyncAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastMetafieldSyncAt" TIMESTAMP(3),
    "mapping" JSONB,
    "mappingUnit" TEXT,
    "job" TEXT,
    "startedAt" TIMESTAMP(3),
    "productCursor" BIGINT NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "limitReached" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "retryAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease" TEXT,
    "leaseUntil" TIMESTAMP(3),

    CONSTRAINT "CatalogSync_pkey" PRIMARY KEY ("storeId")
);

-- CreateTable
CREATE TABLE "CatalogProductChange" (
    "storeId" TEXT NOT NULL,
    "productId" BIGINT NOT NULL,
    "revision" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogProductChange_pkey" PRIMARY KEY ("storeId","productId")
);

-- CreateIndex
CREATE INDEX "CatalogProduct_storeId_title_id_idx" ON "CatalogProduct"("storeId", "title", "id");

-- CreateIndex
CREATE INDEX "CatalogVariant_storeId_productId_id_idx" ON "CatalogVariant"("storeId", "productId", "id");

-- CreateIndex
CREATE INDEX "CatalogSync_nextSyncAt_idx" ON "CatalogSync"("nextSyncAt");

-- CreateIndex
CREATE INDEX "CatalogProductChange_dueAt_idx" ON "CatalogProductChange"("dueAt");

-- AddForeignKey
ALTER TABLE "CatalogProduct" ADD CONSTRAINT "CatalogProduct_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogVariant" ADD CONSTRAINT "CatalogVariant_storeId_productId_fkey" FOREIGN KEY ("storeId", "productId") REFERENCES "CatalogProduct"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogSync" ADD CONSTRAINT "CatalogSync_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogProductChange" ADD CONSTRAINT "CatalogProductChange_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

