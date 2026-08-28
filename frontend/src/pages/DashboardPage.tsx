import { useOutletContext } from "react-router-dom";
import { useMemo, useState } from "react";
import { MetricCard } from "../components/dashboard/MetricCard";
import { AllocationChart } from "../components/dashboard/AllocationChart";
import { PerformanceChart } from "../components/dashboard/PerformanceChart";
import { RangeChips } from "../components/dashboard/RangeChips";
import { usePortfolioAllocation } from "../hooks/usePortfolioAllocation";
import { usePortfolioMetrics } from "../hooks/usePortfolioMetrics";
import { usePortfolioPerformance } from "../hooks/usePortfolioPerformance";
import { usePortfolioSummary } from "../hooks/usePortfolioSummary";
import type { AppShellContext } from "../components/layout/AppShell";
import { formatMoney, formatNumber, formatPct, formatPctAbs } from "../utils/format";
import type { Range } from "../types/api.types";

export default function DashboardPage() {
  const { portfolioId } = useOutletContext<AppShellContext>();
  const [range, setRange] = useState<Range>("1Y");

  const { data: summary, isLoading: isSummaryLoading } = usePortfolioSummary(portfolioId);
  const { data: metrics, isLoading: isMetricsLoading, error: metricsError } = usePortfolioMetrics(
    portfolioId,
    range
  );
  const { data: performance, isLoading: isPerformanceLoading } = usePortfolioPerformance(portfolioId, range);
  const { data: allocation, isLoading: isAllocationLoading } = usePortfolioAllocation(portfolioId);

  const currency = summary?.baseCurrency ?? "MYR";
  const metricsHint = useMemo(() => {
    if (!metricsError) return undefined;
    return "Not enough data for this range — sync first or pick a longer range";
  }, [metricsError]);

  if (!portfolioId) return null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Overview</h2>
        <RangeChips value={range} onChange={setRange} />
      </div>

      {metricsHint && (
        <p className="text-sm text-[var(--color-text-muted)]">{metricsHint}</p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label="Portfolio Value"
          value={summary ? formatMoney(summary.totalValue, currency) : "—"}
          hint={summary?.asOfDate ? `As of ${summary.asOfDate}` : undefined}
          isLoading={isSummaryLoading}
        />
        <MetricCard
          label="Today's Return"
          value={summary ? formatPct(summary.todayReturnPct) : "—"}
          hint={summary ? formatMoney(summary.todayReturnValue, currency) : undefined}
          tone={summary?.todayReturnPct}
          isLoading={isSummaryLoading}
        />
        <MetricCard
          label="Unrealized P&L"
          value={summary ? formatMoney(summary.unrealizedPnL, currency) : "—"}
          hint={summary ? formatPct(summary.unrealizedPnLPct) : undefined}
          tone={summary?.unrealizedPnL}
          isLoading={isSummaryLoading}
        />
        <MetricCard
          label="Annual Return"
          value={metrics ? formatPct(metrics.annualReturn) : "—"}
          tone={metrics?.annualReturn}
          isLoading={isMetricsLoading}
        />
        <MetricCard
          label="CAGR"
          value={metrics ? formatPct(metrics.cagr) : "—"}
          tone={metrics?.cagr}
          isLoading={isMetricsLoading}
        />
        <MetricCard
          label="Sharpe Ratio"
          value={metrics ? formatNumber(metrics.sharpeRatio) : "—"}
          isLoading={isMetricsLoading}
        />
        <MetricCard
          label="Volatility"
          value={metrics ? formatPctAbs(metrics.volatility) : "—"}
          hint="Annualized"
          isLoading={isMetricsLoading}
        />
        <MetricCard
          label="Max Drawdown"
          value={metrics ? formatPct(metrics.maxDrawdown) : "—"}
          tone={metrics?.maxDrawdown}
          isLoading={isMetricsLoading}
        />
        <MetricCard
          label="Beta"
          value={metrics ? formatNumber(metrics.beta) : "—"}
          hint="vs benchmark"
          isLoading={isMetricsLoading}
        />
        <MetricCard
          label="Alpha"
          value={metrics ? formatPct(metrics.alpha) : "—"}
          tone={metrics?.alpha}
          isLoading={isMetricsLoading}
        />
      </section>

      <PerformanceChart data={performance} isLoading={isPerformanceLoading} />
      <AllocationChart data={allocation} isLoading={isAllocationLoading} />
    </>
  );
}
