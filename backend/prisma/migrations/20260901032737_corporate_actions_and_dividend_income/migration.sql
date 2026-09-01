-- AlterTable
ALTER TABLE "PortfolioSnapshot" ADD COLUMN     "dividendIncome" DECIMAL(18,6) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "StockSplit" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "numerator" INTEGER NOT NULL,
    "denominator" INTEGER NOT NULL,

    CONSTRAINT "StockSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dividend" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exDate" DATE NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "currency" "Currency" NOT NULL,

    CONSTRAINT "Dividend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockSplit_symbol_date_idx" ON "StockSplit"("symbol", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StockSplit_symbol_date_key" ON "StockSplit"("symbol", "date");

-- CreateIndex
CREATE INDEX "Dividend_symbol_exDate_idx" ON "Dividend"("symbol", "exDate");

-- CreateIndex
CREATE UNIQUE INDEX "Dividend_symbol_exDate_key" ON "Dividend"("symbol", "exDate");
