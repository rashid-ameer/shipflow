CREATE TYPE "CombinationMethod" AS ENUM ('sum', 'average', 'highest', 'lowest');
CREATE TYPE "CombinationRequirement" AS ENUM ('any', 'all');

CREATE TABLE "CombinedRateRule" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "description" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "minDays" INTEGER,
  "maxDays" INTEGER,
  "method" "CombinationMethod" NOT NULL,
  "requirement" "CombinationRequirement" NOT NULL,
  "tags" TEXT[] NOT NULL,
  "requireTwoTags" BOOLEAN NOT NULL DEFAULT false,
  "excludedTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "blockingTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "useWinningName" BOOLEAN NOT NULL DEFAULT false,
  "outputTag" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CombinedRateRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CombinedRateRule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CombinedRateRule_storeId_position_key" ON "CombinedRateRule"("storeId", "position");
