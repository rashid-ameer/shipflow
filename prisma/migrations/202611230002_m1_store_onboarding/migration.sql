-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('WELCOME', 'UNITS', 'MODE', 'COMPLETE');

-- CreateEnum
CREATE TYPE "OperatingMode" AS ENUM ('DELIVERY_CUSTOMIZATION', 'CCS_RATES');

-- CreateEnum
CREATE TYPE "CcsStatus" AS ENUM ('UNKNOWN', 'ENABLED', 'DISABLED');

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "onboardingStep" "OnboardingStep" NOT NULL DEFAULT 'WELCOME',
    "mode" "OperatingMode",
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "ccsStatus" "CcsStatus" NOT NULL DEFAULT 'UNKNOWN',
    "ccsModeSelectedAt" TIMESTAMP(3),
    "onboardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreSettings" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "weightUnit" TEXT NOT NULL DEFAULT 'kg',
    "distanceUnit" TEXT NOT NULL DEFAULT 'km',
    "dimensionUnit" TEXT NOT NULL DEFAULT 'cm',
    "volumetricDivisor" DOUBLE PRECISION NOT NULL DEFAULT 5000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_shopDomain_key" ON "Store"("shopDomain");

-- CreateIndex
CREATE UNIQUE INDEX "StoreSettings_storeId_key" ON "StoreSettings"("storeId");

-- AddForeignKey
ALTER TABLE "StoreSettings" ADD CONSTRAINT "StoreSettings_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
