ALTER TABLE "StoreSettings"
  ADD COLUMN "shippingConfiguration" JSONB,
  ADD COLUMN "checkoutAppearance" JSONB,
  ADD COLUMN "checkoutTimezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "mapsCredentials" TEXT;

ALTER TABLE "FixedShippingRate"
  ADD COLUMN "serviceCode" TEXT,
  ADD COLUMN "minDays" INTEGER,
  ADD COLUMN "maxDays" INTEGER;

ALTER TABLE "CombinedRateRule" ADD COLUMN "serviceCode" TEXT;
