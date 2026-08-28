import { useMemo, useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MetricCard } from "../components/dashboard/MetricCard";
import { useAuthStore } from "../store/auth.store";
import { usePortfolioMetrics } from "../hooks/usePortfolioMetrics";
import { usePortfolioSummary } from "../hooks/usePortfolioSummary";
import { usePortfolios } from "../hooks/usePortfolios";
import { AllocationChart } from "../components/dashboard/AllocationChart";
import { PerformanceChart } from "../components/dashboard/PerformanceChart";
import { RiskGauge } from "../components/dashboard/RiskGauge";
import { usePortfolioAllocation } from "../hooks/usePortfolioAllocation";
import { usePortfolioPerformance } from "../hooks/usePortfolioPerformance";
import { formatMoney, formatNumber, formatPct, formatPctAbs } from "../utils/format";
import { PriceChart } from "../components/dashboard/PriceChart";
import { useHoldingPrices } from "../hooks/useHoldingPrices";
import { HoldingsTable } from "../components/dashboard/HoldingsTable";
import { useHoldings } from "../hooks/useHoldings";
import type { Range } from "../types/api.types";
import { AddTransactionForm } from "../components/dashboard/AddTransactionForm";
import { SyncButton } from "../components/dashboard/SyncButton";
import { CreatePortfolioForm } from "../components/dashboard/CreatePortfolioForm";
import { RenamePortfolioForm } from "../components/dashboard/RenamePortfolioForm";
import { TransactionsTable } from "../components/dashboard/TransactionsTable";
import { deletePortfolio } from "../api/portfolio.api";


const RANGES: Range[] = ["1M", "3M", "6M", "1Y", "YTD", "ALL"];

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [range, setRange] = useState<Range>("1Y");

  const queryClient = useQueryClient();
  const { data: portfolios, isLoading: isPortfoliosLoading } = usePortfolios();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [isCreating, setIsCreating] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string | undefined>();

useEffect(() => {
  if (!portfolios || portfolios.length === 0) {
    setSelectedId(undefined);
    return;
  }
  const stillExists = selectedId && portfolios.some((p) => p.id === selectedId);
  if (!stillExists) {
    setSelectedId(portfolios[0].id);
  }
}, [portfolios, selectedId]);

  const portfolioId = selectedId;
  const selectedPortfolio = portfolios?.find((p) => p.id === portfolioId);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePortfolio(id),
    onSuccess: async (_result, deletedId) => {
      await queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio", deletedId] });
      setIsRenaming(false);
      setIsCreating(false);
    },
  });

  const { data: summary, isLoading: isSummaryLoading } = usePortfolioSummary(portfolioId);
  const { data: metrics, isLoading: isMetricsLoading, error: metricsError } = usePortfolioMetrics(
    portfolioId,
    range
  );
  const { data: performance, isLoading: isPerformanceLoading } = usePortfolioPerformance(portfolioId, range);
  const { data: allocation, isLoading: isAllocationLoading } = usePortfolioAllocation(portfolioId);
  const { data: holdings, isLoading: isHoldingsLoading } = useHoldings(portfolioId);
  const { data: prices, isLoading: isPricesLoading } = useHoldingPrices(
    portfolioId,
    selectedSymbol,
    range
  );

  useEffect(() => {
    if (!holdings || holdings.length === 0) {
      setSelectedSymbol(undefined);
      return;
    }
    const stillHeld = selectedSymbol && holdings.some((h) => h.symbol === selectedSymbol);
    if (!stillHeld) {
      setSelectedSymbol(holdings[0].symbol);
    }
  }, [holdings, selectedSymbol]);

  const currency = summary?.baseCurrency ?? "MYR";
  const isLoading = isPortfoliosLoading || isSummaryLoading;
  const selectedHolding = holdings?.find((h) => h.symbol === selectedSymbol);

  const metricsHint = useMemo(() => {
    if (!metricsError) return undefined;
    return "Not enough data for this range — sync first or pick a longer range";
  }, [metricsError]);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-slate-800 px-8 py-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Quantify</p>
          <h1 className="text-xl font-semibold">{summary?.name ?? "Dashboard"}</h1>
        </div>
          {portfolios && portfolios.length > 0 && (
            <label htmlFor="portfolio-select" className="sr-only">
              Portfolio
            </label>
          )}
          {portfolios && portfolios.length > 0 && (
            <div className="flex items-center gap-2">
            <select
              id="portfolio-select"
              value={portfolioId ?? ""}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setIsRenaming(false);
                setIsCreating(false);
              }}
              className="mt-2 rounded-md bg-transparent border border-slate-600 px-2 py-1 text-sm"
            >
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
                type="button"
                onClick={() => {
                  setIsCreating((open) => !open);
                  setIsRenaming(false);
                }}
                className="mt-2 rounded-md border border-slate-600 px-2 py-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                 {isCreating ? "Cancel" : "Create"}
              </button>
            <button
                type="button"
                onClick={() => {
                  setIsRenaming((open) => !open);
                  setIsCreating(false);
                }}
                className="mt-2 rounded-md border border-slate-600 px-2 py-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                >
                 {isRenaming ? "Cancel" : "Rename"}
              </button>
            <button
                type="button"
                disabled={!portfolioId || deleteMutation.isPending}
                onClick={() => {
                  const name = selectedPortfolio?.name ?? "this portfolio";
                  if (
                    window.confirm(
                      `Delete "${name}"? Holdings, transactions, and snapshots will be removed.`
                    )
                  ) {
                    deleteMutation.mutate(portfolioId!);
                  }
                }}
                className="mt-2 rounded-md border border-slate-600 px-2 py-1 text-sm text-[var(--color-danger)] hover:text-red-400 disabled:opacity-50"
                >
                 {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
              </div>
          )}
        <div className="flex items-center gap-4">
          <span className="text-sm text-[var(--color-text-muted)]">{user?.name}</span>
          <button
            type="button"
            onClick={logout}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Log out
          </button>
          <SyncButton />
        </div>
      </header>

      <main className="p-8 space-y-6">
        {!isPortfoliosLoading && !portfolioId && (
          <CreatePortfolioForm onCreated={setSelectedId} />
        )}
        {portfolioId && isCreating && (
          <CreatePortfolioForm
          onCreated={(id) => {
            setSelectedId(id);
            setIsCreating(false);
          }}
          />
        )}
        {portfolioId && isRenaming && selectedPortfolio && (
          <RenamePortfolioForm
            key={portfolioId}
            portfolioId={portfolioId}
            currentName={selectedPortfolio.name}
            onDone={() => setIsRenaming(false)}
          />
        )}
        {deleteMutation.isError && (
          <p className="text-sm text-[var(--color-danger)]">Failed to delete portfolio. Please try again.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {RANGES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setRange(item)}
              className={`rounded-md px-3 py-1 text-sm ${
                range === item
                  ? "bg-[var(--color-accent)] text-slate-900"
                  : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"
              }`}
            >
              {item}
            </button>
          ))}
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Portfolio Value"
            value={summary ? formatMoney(summary.totalValue, currency) : "—"}
            hint={summary?.asOfDate ? `As of ${summary.asOfDate}` : undefined}
            isLoading={isLoading}
          />
          <MetricCard
            label="Today's Return"
            value={summary ? formatPct(summary.todayReturnPct) : "—"}
            hint={summary ? formatMoney(summary.todayReturnValue, currency) : undefined}
            tone={summary?.todayReturnPct}
            isLoading={isLoading}
          />
          <MetricCard
            label="Sharpe Ratio"
            value={metrics ? formatNumber(metrics.sharpeRatio) : "—"}
            hint={metricsHint ?? (metrics ? `Range ${metrics.range}` : undefined)}
            isLoading={isMetricsLoading}
          />
          <MetricCard
            label="Volatility"
            value={metrics ? formatPctAbs(metrics.volatility) : "—"}
            hint={metricsHint ?? (metrics ? `Annualized · ${metrics.range}` : undefined)}
            isLoading={isMetricsLoading}
          />
          <MetricCard
            label="Unrealized P&L"
            value={summary ? formatMoney(summary.unrealizedPnL, currency) : "—"}
            hint={summary ? formatPct(summary.unrealizedPnLPct) : undefined}
            tone={summary?.unrealizedPnL}
            isLoading={isLoading}
          />
          <MetricCard
            label="Annual Return"
            value={metrics ? formatPct(metrics.annualReturn) : "—"}
            hint={metricsHint ?? (metrics ? `Annualized · ${metrics.range}` : undefined)}
            tone={metrics?.annualReturn}
            isLoading={isMetricsLoading}
          />
          <MetricCard
            label="CAGR"
            value={metrics ? formatPct(metrics.cagr) : "—"}
            hint={metricsHint ?? (metrics ? `Range ${metrics.range}` : undefined)}
            tone={metrics?.cagr}
            isLoading={isMetricsLoading}
          />
          <MetricCard
            label="Max Drawdown"
            value={metrics ? formatPct(metrics.maxDrawdown) : "—"}
            hint={metricsHint ?? (metrics ? `Range ${metrics.range}` : undefined)}
            tone={metrics?.maxDrawdown}
            isLoading={isMetricsLoading}
          />
          <MetricCard
            label="Beta"
            value={metrics ? formatNumber(metrics.beta) : "—"}
            hint={metricsHint ?? (metrics ? `vs benchmark · ${metrics.range}` : undefined)}
            isLoading={isMetricsLoading}
          />
          <MetricCard
            label="Alpha"
            value={metrics ? formatPct(metrics.alpha) : "—"}
            hint={metricsHint ?? (metrics ? `Annualized · ${metrics.range}` : undefined)}
            tone={metrics?.alpha}
            isLoading={isMetricsLoading}
          />
        </section>
        <section className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <PerformanceChart data={performance} isLoading={isPerformanceLoading} />
          </div>
          <RiskGauge volatility={metrics?.volatility} isLoading={isMetricsLoading} />
        </section>

        <AllocationChart data={allocation} isLoading={isAllocationLoading} />
        <HoldingsTable
          holdings={holdings}
          allocation={allocation}
          currency={currency}
          isLoading={isHoldingsLoading}
          selectedSymbol={selectedSymbol}
          onSelectSymbol={setSelectedSymbol}
        />
        {selectedSymbol && (
          <PriceChart
            data={prices}
            avgCost={selectedHolding ? Number(selectedHolding.avgCost) : undefined}
            isLoading={isPricesLoading}
          />
        )}
        {portfolioId && <AddTransactionForm portfolioId={portfolioId} />}
        {portfolioId && <TransactionsTable key={portfolioId} portfolioId={portfolioId} />}
      </main>
    </div>
  );
}