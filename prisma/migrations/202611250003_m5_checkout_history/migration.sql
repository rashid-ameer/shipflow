ALTER TABLE "CarrierRequest"
ADD COLUMN "statusCode" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN "customerId" TEXT,
ADD COLUMN "snapshot" JSONB,
ADD COLUMN "trace" JSONB;

CREATE INDEX "CarrierRequest_storeId_customerId_receivedAt_idx"
ON "CarrierRequest"("storeId", "customerId", "receivedAt");
