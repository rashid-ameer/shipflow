CREATE TABLE "HistoryDataRequest" (
  "storeId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoryDataRequest_pkey" PRIMARY KEY ("storeId", "requestId"),
  CONSTRAINT "HistoryDataRequest_storeId_fkey" FOREIGN KEY ("storeId")
    REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "HistoryDataRequest_storeId_customerId_idx"
ON "HistoryDataRequest"("storeId", "customerId");
