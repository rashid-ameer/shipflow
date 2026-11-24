ALTER TABLE "Store" ADD COLUMN "carrierServiceId" TEXT;
CREATE UNIQUE INDEX "Store_carrierServiceId_key" ON "Store"("carrierServiceId");

CREATE TYPE "ShippingRegionKind" AS ENUM ('DOMESTIC', 'CUSTOM', 'REST');

CREATE TABLE "ShippingRegion" (
  "id" TEXT PRIMARY KEY, "storeId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "kind" "ShippingRegionKind" NOT NULL, "coverage" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShippingRegion_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ShippingRegion_storeId_id_key" ON "ShippingRegion"("storeId", "id");
CREATE UNIQUE INDEX "ShippingRegion_storeId_name_key" ON "ShippingRegion"("storeId", "name");

CREATE TABLE "RateScenario" (
  "id" TEXT PRIMARY KEY, "storeId" TEXT NOT NULL, "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RateScenario_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RateScenario_storeId_id_key" ON "RateScenario"("storeId", "id");
CREATE INDEX "RateScenario_storeId_active_idx" ON "RateScenario"("storeId", "active");

CREATE TABLE "RateCondition" (
  "scenarioId" TEXT NOT NULL, "position" INTEGER NOT NULL, "condition" JSONB NOT NULL,
  PRIMARY KEY ("scenarioId", "position"),
  CONSTRAINT "RateCondition_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "RateScenario"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FixedShippingRate" (
  "id" TEXT PRIMARY KEY, "storeId" TEXT NOT NULL, "scenarioId" TEXT NOT NULL,
  "regionId" TEXT NOT NULL, "position" INTEGER NOT NULL,
  "name" TEXT NOT NULL, "description" TEXT NOT NULL, "amount" INTEGER NOT NULL, "currency" TEXT NOT NULL,
  CONSTRAINT "FixedShippingRate_storeId_scenarioId_fkey" FOREIGN KEY ("storeId", "scenarioId") REFERENCES "RateScenario"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FixedShippingRate_storeId_regionId_fkey" FOREIGN KEY ("storeId", "regionId") REFERENCES "ShippingRegion"("storeId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FixedShippingRate_storeId_scenarioId_idx" ON "FixedShippingRate"("storeId", "scenarioId");
CREATE INDEX "FixedShippingRate_storeId_regionId_idx" ON "FixedShippingRate"("storeId", "regionId");

CREATE TABLE "CarrierRequest" (
  "id" TEXT PRIMARY KEY, "storeId" TEXT NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "country" TEXT NOT NULL, "province" TEXT, "currency" TEXT NOT NULL,
  "testIdentity" TEXT NOT NULL, "reason" TEXT NOT NULL, "rateCount" INTEGER NOT NULL,
  CONSTRAINT "CarrierRequest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CarrierRequest_storeId_receivedAt_idx" ON "CarrierRequest"("storeId", "receivedAt");
