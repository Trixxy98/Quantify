import { useMemo, useState } from "react";
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
import { HoldingsTable } from "../components/dashboard/HoldingsTable";
import { useHoldings } from "../hooks/useHoldings";
import type { Range } from "../types/api.types";
import { AddTransactionForm } from "../components/dashboard/AddTransactionForm";
import { SyncButton } from "../components/dashboard/SyncButton";


const RANGES: Range[] = ["1M", "3M", "6M", "1Y", "YTD", "ALL"];

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [range, setRange] = useState<Range>("1Y");

  const { data: portfolios, isLoading: isPortfoliosLoading } = usePortfolios();
  const portfolioId = portfolios?.[0]?.id;

  const { data: summary, isLoading: isSummaryLoading } = usePortfolioSummary(portfolioId);
  const { data: metrics, isLoading: isMetricsLoading, error: metricsError } = usePortfolioMetrics(
    portfolioId,
    range
  );
  const { data: performance, isLoading: isPerformanceLoading } = usePortfolioPerformance(portfolioId, range);
  const { data: allocation, isLoading: isAllocationLoading } = usePortfolioAllocation(portfolioId);
  const { data: holdings, isLoading: isHoldingsLoading } = useHoldings(portfolioId);

  const currency = summary?.baseCurrency ?? "MYR";
  const isLoading = isPortfoliosLoading || isSummaryLoading;

  const metricsHint = useMemo(() => {
    if (!metricsError) return undefined;
    return "Data tidak cukup untuk julat ini — sync dulu atau pilih julat lebih panjang";
  }, [metricsError]);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-slate-800 px-8 py-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Quantify</p>
          <h1 className="text-xl font-semibold">{summary?.name ?? "Dashboard"}</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-[var(--color-text-muted)]">{user?.name}</span>
          <button
            type="button"
            onClick={logout}
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Log keluar
          </button>
          <SyncButton />
        </div>
      </header>

      <main className="p-8 space-y-6">
        {!isPortfoliosLoading && !portfolioId && (
          <p className="text-[var(--color-text-muted)]">
            Tiada portfolio lagi. Tambah portfolio + transaction di backend, lepas tu sync.
          </p>
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
            hint={metrics ? `Annualized · ${metrics.range}` : undefined}
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
        />
        {portfolioId && <AddTransactionForm portfolioId={portfolioId} />}
      </main>
    </div>
  );
}