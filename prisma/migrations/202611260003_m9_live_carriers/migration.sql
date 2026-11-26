ALTER TABLE "FixedShippingRate" ADD COLUMN "liveCarrier" JSONB;

CREATE TABLE "CarrierConnection" (
    "storeId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "services" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "error" TEXT,
    "revision" TEXT NOT NULL,
    CONSTRAINT "CarrierConnection_pkey" PRIMARY KEY ("storeId", "carrier"),
    CONSTRAINT "CarrierConnection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
