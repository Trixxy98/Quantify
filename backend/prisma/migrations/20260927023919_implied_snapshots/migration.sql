-- CreateTable
CREATE TABLE "ImpliedSnapshot" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "expiry" DATE NOT NULL,
    "spot" DECIMAL(18,6) NOT NULL,
    "strike" DECIMAL(18,6) NOT NULL,
    "atmIv" DECIMAL(12,8) NOT NULL,
    "straddleMove" DECIMAL(12,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpliedSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImpliedSnapshot_symbol_date_idx" ON "ImpliedSnapshot"("symbol", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ImpliedSnapshot_symbol_date_key" ON "ImpliedSnapshot"("symbol", "date");
