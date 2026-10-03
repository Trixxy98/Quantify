-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "Exchange" AS ENUM ('BURSA', 'US');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('MYR', 'USD');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" "Currency" NOT NULL DEFAULT 'MYR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" "Exchange" NOT NULL,
    "currency" "Currency" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "avgCost" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "currency" "Currency" NOT NULL,
    "fee" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPrice" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "open" DECIMAL(18,6) NOT NULL,
    "high" DECIMAL(18,6) NOT NULL,
    "low" DECIMAL(18,6) NOT NULL,
    "close" DECIMAL(18,6) NOT NULL,
    "volume" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,

    CONSTRAINT "DailyPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "totalValue" DECIMAL(18,6) NOT NULL,
    "totalCost" DECIMAL(18,6) NOT NULL,
    "dividendIncome" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "trigger" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "rows" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentForecast" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "horizon" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "value" DECIMAL(18,10) NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsHeadline" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "published" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT NOT NULL,
    "link" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsHeadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactorReturn" (
    "date" DATE NOT NULL,
    "factor" TEXT NOT NULL,
    "value" DECIMAL(16,10) NOT NULL,

    CONSTRAINT "FactorReturn_pkey" PRIMARY KEY ("date","factor")
);

-- CreateTable
CREATE TABLE "BenchmarkPrice" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "close" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "BenchmarkPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "from" "Currency" NOT NULL,
    "to" "Currency" NOT NULL,
    "date" DATE NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Portfolio_userId_idx" ON "Portfolio"("userId");

-- CreateIndex
CREATE INDEX "Holding_symbol_idx" ON "Holding"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_portfolioId_symbol_key" ON "Holding"("portfolioId", "symbol");

-- CreateIndex
CREATE INDEX "Transaction_portfolioId_date_idx" ON "Transaction"("portfolioId", "date");

-- CreateIndex
CREATE INDEX "Transaction_symbol_idx" ON "Transaction"("symbol");

-- CreateIndex
CREATE INDEX "DailyPrice_symbol_date_idx" ON "DailyPrice"("symbol", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPrice_symbol_date_key" ON "DailyPrice"("symbol", "date");

-- CreateIndex
CREATE INDEX "PortfolioSnapshot_portfolioId_date_idx" ON "PortfolioSnapshot"("portfolioId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioSnapshot_portfolioId_date_key" ON "PortfolioSnapshot"("portfolioId", "date");

-- CreateIndex
CREATE INDEX "StockSplit_symbol_date_idx" ON "StockSplit"("symbol", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StockSplit_symbol_date_key" ON "StockSplit"("symbol", "date");

-- CreateIndex
CREATE INDEX "Dividend_symbol_exDate_idx" ON "Dividend"("symbol", "exDate");

-- CreateIndex
CREATE UNIQUE INDEX "Dividend_symbol_exDate_key" ON "Dividend"("symbol", "exDate");

-- CreateIndex
CREATE INDEX "ImpliedSnapshot_symbol_date_idx" ON "ImpliedSnapshot"("symbol", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ImpliedSnapshot_symbol_date_key" ON "ImpliedSnapshot"("symbol", "date");

-- CreateIndex
CREATE INDEX "SyncRun_ok_finishedAt_idx" ON "SyncRun"("ok", "finishedAt");

-- CreateIndex
CREATE INDEX "AgentRun_agent_asOf_idx" ON "AgentRun"("agent", "asOf");

-- CreateIndex
CREATE INDEX "AgentForecast_agent_asOf_idx" ON "AgentForecast"("agent", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "AgentForecast_agent_symbol_asOf_horizon_target_key" ON "AgentForecast"("agent", "symbol", "asOf", "horizon", "target");

-- CreateIndex
CREATE INDEX "NewsHeadline_symbol_published_idx" ON "NewsHeadline"("symbol", "published");

-- CreateIndex
CREATE UNIQUE INDEX "NewsHeadline_symbol_sourceId_key" ON "NewsHeadline"("symbol", "sourceId");

-- CreateIndex
CREATE INDEX "FactorReturn_factor_date_idx" ON "FactorReturn"("factor", "date");

-- CreateIndex
CREATE INDEX "BenchmarkPrice_symbol_date_idx" ON "BenchmarkPrice"("symbol", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkPrice_symbol_date_key" ON "BenchmarkPrice"("symbol", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_from_to_date_key" ON "ExchangeRate"("from", "to", "date");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holding" ADD CONSTRAINT "Holding_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioSnapshot" ADD CONSTRAINT "PortfolioSnapshot_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentForecast" ADD CONSTRAINT "AgentForecast_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

