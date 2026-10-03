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

-- AddForeignKey
ALTER TABLE "AgentForecast" ADD CONSTRAINT "AgentForecast_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
