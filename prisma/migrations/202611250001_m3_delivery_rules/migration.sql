CREATE TABLE "DeliveryRule" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL,
  "rule" JSONB NOT NULL,
  "revision" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeliveryRule_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DeliveryRule_storeId_createdAt_idx" ON "DeliveryRule"("storeId", "createdAt");
