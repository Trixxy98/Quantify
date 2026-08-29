import { useMemo, useState } from "react";
import axios from "axios";
import { IvSliceCharts } from "../components/vol/IvSliceCharts";
import { IvSurfaceCanvas } from "../components/vol/IvSurfaceCanvas";
import { MetricCard } from "../components/dashboard/MetricCard";
import { SymbolSearchField } from "../components/dashboard/SymbolSearchField";
import { useHoldings } from "../hooks/useHoldings";
import { useIvSurface } from "../hooks/useIvSurface";
import { useOutletContext } from "react-router-dom";
import type { AppShellContext } from "../components/layout/AppShell";
import { formatMoney, formatPctAbs } from "../utils/format";

const QUICK = ["AAPL", "MSFT", "NVDA", "TSLA", "SPY", "QQQ"];

function atmOf(points: {moneyness: number; iv: number; ttm: number}[]) {
  const near = points.filter((p) => p.ttm === Math.min(...points.map((x) => x.ttm)));
  const row = (near.length ? near : points).reduce((best, p) =>
    Math.abs(p.moneyness - 1) < Math.abs(best.moneyness - 1) ? p : best
  );
  return row;
}

export default function VolPage() {
  const { portfolioId } = useOutletContext<AppShellContext>();
  const { data: holdings } = useHoldings(portfolioId);
  const usHoldings = holdings?.filter((h) => !h.symbol.includes(".")) ?? [];
  const [symbol, setSymbol] = useState("AAPL");
  const [expiry, setExpiry] = useState<string | null>(null);
  const { data, isFetching, isError, error } = useIvSurface(symbol);

  const expiries = useMemo(
    () => [...new Set(data?.points.map((p) => p.expiry) ?? [])].sort(),
    [data]
  );
  const selectedExpiry = expiry && expiries.includes(expiry) ? expiry : expiries[0];
  const atm = data && data.points.length > 0 ? atmOf(data.points) : null;

  const errorMessage = axios.isAxiosError(error)
    ? error.response?.data?.error?.message ?? "Could not build the surface"
    : isError
      ? "Could not build the surface"
      : null;

  const inputClass = "w-full max-w-sm rounded-md bg-transparent border border-slate-600 px-3 py-2 text-sm";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--color-text-muted)]">IV surface</h2>
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-text-muted)]">
            Yahoo options chain → mid price → invert European Black–Scholes (Newton, bisection fallback).
            US listed options are American; treat IV as a teaching approximation. Bursa has no chain here.
          </p>
        </div>
        {expiries.length > 0 && (
          <label className="text-xs text-[var(--color-text-muted)]">
            Skew expiry
            <select
              className="ml-2 rounded-md border border-slate-600 bg-transparent px-2 py-1 text-sm text-[var(--color-text)]"
              value={selectedExpiry}
              onChange={(e) => setExpiry(e.target.value)}
            >
              {expiries.map((date) => (
                <option key={date} value={date}>
                  {date}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {QUICK.map((ticker) => (
          <button
            key={ticker}
            type="button"
            onClick={() => {
              setSymbol(ticker);
              setExpiry(null);
            }}
            className={`rounded-md px-2.5 py-1 text-xs ${
              symbol === ticker
                ? "bg-[var(--color-accent)] text-slate-900"
                : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"
            }`}
          >
            {ticker}
          </button>
        ))}
        <div className="min-w-[12rem] flex-1">
          <SymbolSearchField
            id="iv-symbol"
            value={symbol}
            onChange={(next) => {
              setSymbol(next.trim().toUpperCase());
              setExpiry(null);
            }}
            className={inputClass}
            holdings={usHoldings}
          />
        </div>
      </div>

      {errorMessage && <p className="text-sm text-[var(--color-danger)]">{errorMessage}</p>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Spot" value={data ? formatMoney(data.spot, "USD") : "—"} isLoading={isFetching} />
        <MetricCard
          label="Front ATM IV"
          value={atm ? formatPctAbs(atm.iv) : "—"}
          isLoading={isFetching}
        />
        <MetricCard
          label="Quotes inverted"
          value={data ? String(data.points.length) : "—"}
          hint={data ? `${data.newtonCount} Newton · ${data.bisectionCount} bisection` : undefined}
          isLoading={isFetching}
        />
        <MetricCard
          label="r (risk-free)"
          value={data ? formatPctAbs(data.rate) : "—"}
          isLoading={isFetching}
        />
        <MetricCard
          label="q (div yield)"
          value={data ? formatPctAbs(data.dividendYield) : "—"}
          isLoading={isFetching}
        />
      </section>

      {isFetching && !data ? (
        <div className="h-[28rem] rounded-xl bg-[var(--color-surface)] animate-pulse" />
      ) : data ? (
        <>
          <IvSurfaceCanvas points={data.points} />
          {selectedExpiry && <IvSliceCharts points={data.points} expiry={selectedExpiry} />}
        </>
      ) : null}
    </>
  );
}
