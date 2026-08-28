import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { AttributionTable } from "../components/analysis/AttributionTable";
import { ContributionChart } from "../components/analysis/ContributionChart";
import { ScenarioPanel } from "../components/analysis/ScenarioPanel";
import { MetricCard } from "../components/dashboard/MetricCard";
import { RangeChips } from "../components/dashboard/RangeChips";
import { usePortfolioAnalysis } from "../hooks/usePortfolioAnalysis";
import type { AppShellContext } from "../components/layout/AppShell";
import { formatMoney, formatPctAbs } from "../utils/format";
import type { Range } from "../types/api.types";

export default function AnalysisPage() {
  const { portfolioId } = useOutletContext<AppShellContext>();
  const [range, setRange] = useState<Range>("1Y");
  const { data, isLoading } = usePortfolioAnalysis(portfolioId, range);
  const currency = data?.baseCurrency ?? "MYR";

  const top = useMemo(() => {
    const items = data?.items ?? [];
    const held = items.filter((row) => row.marketValue != null);
    const contributor = items.reduce(
      (best, row) => (row.contribution > (best?.contribution ?? -Infinity) ? row : best),
      items[0]
    );
    const riskiest = held.reduce(
      (best, row) => (row.riskShare > (best?.riskShare ?? -Infinity) ? row : best),
      held[0]
    );
    return { contributor, riskiest };
  }, [data?.items]);

  if (!portfolioId) return null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Analysis</h2>
        <RangeChips value={range} onChange={setRange} />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Range P&L"
          value={data ? formatMoney(data.totalContribution, currency) : "—"}
          hint={data?.asOf ? `As of ${data.asOf}` : undefined}
          tone={data?.totalContribution}
          isLoading={isLoading}
        />
        <MetricCard
          label="Of which FX"
          value={data ? formatMoney(data.fxContribution, currency) : "—"}
          hint="Currency translation"
          tone={data?.fxContribution}
          isLoading={isLoading}
        />
        <MetricCard
          label="Top contributor"
          value={top.contributor ? top.contributor.symbol : "—"}
          hint={top.contributor ? formatMoney(top.contributor.contribution, currency) : undefined}
          tone={top.contributor?.contribution}
          isLoading={isLoading}
        />
        <MetricCard
          label="Largest risk"
          value={top.riskiest ? top.riskiest.symbol : "—"}
          hint={top.riskiest ? `${formatPctAbs(top.riskiest.riskShare)} of variance` : undefined}
          isLoading={isLoading}
        />
      </section>

      {top.riskiest && top.riskiest.riskShare >= 0.4 && (
        <p className="text-sm text-[var(--color-text-muted)]">
          {top.riskiest.symbol} accounts for {formatPctAbs(top.riskiest.riskShare)} of portfolio variance in this range.
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <ContributionChart items={data?.items ?? []} currency={currency} isLoading={isLoading} />
        <ScenarioPanel
          totalValue={data?.scenario.totalValue ?? 0}
          positions={data?.scenario.positions ?? []}
          currency={currency}
          isLoading={isLoading}
        />
      </div>

      <AttributionTable items={data?.items ?? []} currency={currency} isLoading={isLoading} />
    </>
  );
}
