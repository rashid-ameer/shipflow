-- Milestone 2 persists the global app status and the remaining basic CCS settings.
ALTER TABLE "Store"
ADD COLUMN "appEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "StoreSettings"
ADD COLUMN "multipleRates" TEXT NOT NULL DEFAULT 'all',
ADD COLUMN "rounding" TEXT NOT NULL DEFAULT 'none';
