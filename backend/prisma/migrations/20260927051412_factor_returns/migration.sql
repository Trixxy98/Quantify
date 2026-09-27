-- CreateTable
CREATE TABLE "FactorReturn" (
    "date" DATE NOT NULL,
    "factor" TEXT NOT NULL,
    "value" DECIMAL(16,10) NOT NULL,

    CONSTRAINT "FactorReturn_pkey" PRIMARY KEY ("date","factor")
);

-- CreateIndex
CREATE INDEX "FactorReturn_factor_date_idx" ON "FactorReturn"("factor", "date");
