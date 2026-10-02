import { useMemo, useState } from "react";
import axios from "axios";
import { useOutletContext } from "react-router-dom";
import { EventCarChart } from "../components/events/EventCarChart";
import { EventPremiumChart } from "../components/events/EventPremiumChart";
import { EventControls, type StudySettings } from "../components/events/EventControls";
import { EventDistributionChart } from "../components/events/EventDistributionChart";
import { EventEquityChart } from "../components/events/EventEquityChart";
import { EventTable } from "../components/events/EventTable";
import { MetricCard } from "../components/dashboard/MetricCard";
import { useEventStudy } from "../hooks/useEventStudy";
import { useVariancePremium } from "../hooks/useVariancePremium";
import { useHoldings } from "../hooks/useHoldings";
import type { AppShellContext } from "../components/layout/AppShell";
import { formatInterval, formatNumber, formatPct, formatPctAbs } from "../utils/format";

const MAX_POOLED = 8;

export default function EventsPage() {
  const { portfolioId } = useOutletContext<AppShellContext>();
  const { data: holdings } = useHoldings(portfolioId);
  const usHoldings = useMemo(
    () => (holdings ?? []).filter((h) => !h.symbol.includes(".")),
    [holdings]
  );

  const [settings, setSettings] = useState<StudySettings>({
    type: "FOMC",
    symbol: "SPY",
    pooled: false,
    pre: 5,
    post: 10,
    years: 5,
    hold: 3,
  });

  const symbols = useMemo(() => {
    if (settings.pooled) {
      return usHoldings.slice(0, MAX_POOLED).map((h) => h.symbol);
    }
    return settings.symbol ? [settings.symbol] : [];
  }, [settings.pooled, settings.symbol, usHoldings]);

  const { data, isFetching, isError, error } = useEventStudy({
    symbols,
    type: settings.type,
    pre: settings.pre,
    post: settings.post,
    years: settings.years,
    hold: settings.hold,
  });

  const errorMessage = axios.isAxiosError(error)
    ? error.response?.data?.error?.message ?? "Could not run the study"
    : isError
      ? "Could not run the study"
      : null;

  const premiumQuery = useVariancePremium(settings.symbol, settings.type, settings.years);
  const premium = premiumQuery.data;
  const endOffset = data?.offsets[data.offsets.length - 1];

  function patch(next: Partial<StudySettings>) {
    setSettings((current) => ({...current, ...next}));
  }

  return (
    <>
      <div>
        <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Event study</h2>
        <p className="mt-1 max-w-3xl text-xs text-[var(--color-text-muted)]">
          How a name behaves around information events instead of chart patterns. Returns are measured against a
          market model fitted before each event, so what is left is the reaction.
          {data && ` ${data.benchmark} · ${data.from} to ${data.to}`}
        </p>
      </div>

      <EventControls value={settings} onChange={patch} usHoldings={usHoldings} pooledSymbols={symbols} />

      {errorMessage && <p className="text-sm text-[var(--color-danger)]">{errorMessage}</p>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Events"
          value={data ? String(data.eventCount) : "—"}
          hint={data && data.skippedCount > 0 ? `${data.skippedCount} skipped (no clean window)` : undefined}
          isLoading={isFetching}
        />
        <MetricCard
          label={`CAR to day +${settings.post}`}
          value={endOffset ? formatPct(endOffset.acar) : "—"}
          hint={
            endOffset && data
              ? [
                  `t = ${formatNumber(endOffset.tStat)}`,
                  formatInterval(data.finalCar.interval, (value) => formatPct(value, 1)) ??
                    `${data.finalCar.dates} event dates, too few for a range`,
                ].join(" · ")
              : undefined
          }
          tone={endOffset?.acar}
          isLoading={isFetching}
        />
        <MetricCard
          label="Event-day volatility"
          value={data ? formatPctAbs(data.distribution.event.sd) : "—"}
          hint={data ? `${formatPctAbs(data.distribution.baseline.sd)} on other days` : undefined}
          isLoading={isFetching}
        />
        <MetricCard
          label="Mean event trade"
          value={data ? formatPct(data.backtest.stats.meanRet) : "—"}
          hint={data ? `win rate ${formatPctAbs(data.backtest.stats.winRate, 1)}` : undefined}
          tone={data?.backtest.stats.meanRet}
          isLoading={isFetching}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Implied move"
          value={premium?.impliedMove != null ? `±${formatPctAbs(premium.impliedMove)}` : "—"}
          hint={
            premium?.method === "term-structure"
              ? `${premium.symbol} · ${premium.expiryBefore} vs ${premium.expiry} term structure`
              : premium?.method === "straddle"
                ? `${premium.symbol} straddle to ${premium.expiry}`
                : premium
                  ? premium.symbol
                  : undefined
          }
          isLoading={premiumQuery.isFetching && !premium}
        />
        <MetricCard
          label="Mean realized"
          value={premium?.stats.meanAbs != null ? formatPctAbs(premium.stats.meanAbs) : "—"}
          hint={
            premium
              ? `median ${premium.stats.medianAbs != null ? formatPctAbs(premium.stats.medianAbs) : "—"} · ${premium.stats.n} past ${settings.type.toLowerCase()} sessions`
              : undefined
          }
          isLoading={premiumQuery.isFetching && !premium}
        />
        <MetricCard
          label="Gap"
          value={premium?.stats.gap != null ? formatPct(premium.stats.gap) : "—"}
          hint="implied minus mean absolute move"
          tone={premium?.stats.gap ?? undefined}
          isLoading={premiumQuery.isFetching && !premium}
        />
        <MetricCard
          label="Vs past moves"
          value={premium?.stats.percentile != null ? formatPctAbs(premium.stats.percentile, 0) : "—"}
          hint={
            premium?.atmIv != null
              ? `ATM IV ${formatPctAbs(premium.atmIv)} · share of past moves below today's price`
              : "share of past moves smaller than today's price"
          }
          isLoading={premiumQuery.isFetching && !premium}
        />
        <MetricCard
          label="IV rank"
          value={premium?.ivHistory ? formatPctAbs(premium.ivHistory.rank, 0) : "—"}
          hint={
            premium?.ivHistory
              ? `${formatPctAbs(premium.ivHistory.low, 1)}–${formatPctAbs(premium.ivHistory.high, 1)} over ${premium.ivHistory.n} recorded sessions`
              : "front-month ATM IV vs the sessions this app has recorded"
          }
          isLoading={premiumQuery.isFetching && !premium}
        />
      </section>

      {premium && (
        <>
          {settings.pooled && (
            <p className="text-xs text-[var(--color-text-muted)]">
              The straddle is priced on {premium.symbol}. Pooling applies to the event study only.
            </p>
          )}
          <EventPremiumChart premium={premium} />
          <ul className="space-y-1 text-xs text-[var(--color-text-muted)]">
            {premium.notes.map((note) => (
              <li key={note}>· {note}</li>
            ))}
          </ul>
        </>
      )}

      {isFetching && !data ? (
        <div className="h-72 rounded-xl bg-[var(--color-surface)] animate-pulse" />
      ) : data ? (
        <>
          <EventCarChart offsets={data.offsets} eventCount={data.eventCount} />
          <div className="grid gap-8 lg:grid-cols-2">
            <EventDistributionChart
              buckets={data.distribution.buckets}
              event={data.distribution.event}
              baseline={data.distribution.baseline}
            />
            <EventEquityChart backtest={data.backtest} />
          </div>
          <EventTable
            events={data.events}
            showSurprise={data.eventType === "EARNINGS"}
            postDays={data.window.post}
          />
          <ul className="space-y-1 text-xs text-[var(--color-text-muted)]">
            {data.notes.map((note) => (
              <li key={note}>· {note}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
