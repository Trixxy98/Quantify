import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getHoldingPrices } from "../api/portfolio.api";
import { RangeChips } from "../components/dashboard/RangeChips";
import type { AppShellContext } from "../components/layout/AppShell";
import { useClosedLots } from "../hooks/useClosedLots";
import { useHoldings } from "../hooks/useHoldings";
import { usePortfolioPerformance } from "../hooks/usePortfolioPerformance";
import { usePortfolioRisk } from "../hooks/usePortfolioRisk";
import type { Range } from "../types/api.types";
import {
  DEFAULT_SERIES,
  readChartViews,
  writeChartViews,
  type ChartAxis,
  type ChartScale,
  type ChartSeriesPick,
  type ChartView,
  type ChartWindow,
} from "../utils/chartViews";

const WINDOWS: ChartWindow[] = [20, 60, 120];
const COLORS = ["#22c55e", "#38bdf8", "#a78bfa", "#f59e0b", "#fb7185", "#e2e8f0", "#34d399", "#818cf8"];

type LevelPoint = {date: string; value: number};

function rebase(points: LevelPoint[], scale: ChartScale): LevelPoint[] {
  const origin = points.find((point) => point.value !== 0 && Number.isFinite(point.value));
  if (!origin) return [];
  return points.map((point) => ({
    date: point.date,
    value:
      scale === "index" ? (point.value / origin.value) * 100 : (point.value / origin.value - 1) * 100,
  }));
}

function kind(id: string): "level" | "pct" | "beta" {
  if (id === "beta") return "beta";
  if (id === "underwater" || id === "vol") return "pct";
  return "level";
}

export default function ChartPage() {
  const {portfolioId} = useOutletContext<AppShellContext>();
  const [range, setRange] = useState<Range>("1Y");
  const [window, setWindow] = useState<ChartWindow>(60);
  const [scale, setScale] = useState<ChartScale>("index");
  const [series, setSeries] = useState<ChartSeriesPick[]>(DEFAULT_SERIES);
  const [views, setViews] = useState<ChartView[]>([]);
  const [activeViewId, setActiveViewId] = useState("");
  const [viewName, setViewName] = useState("");

  const {data: performance, isLoading: isPerformanceLoading} = usePortfolioPerformance(portfolioId, range);
  const {data: risk, isLoading: isRiskLoading} = usePortfolioRisk(portfolioId, range, window);
  const {data: holdings} = useHoldings(portfolioId);
  const {data: closed} = useClosedLots(portfolioId);

  useEffect(() => {
    setSeries(DEFAULT_SERIES);
    setViews(readChartViews(portfolioId));
    setActiveViewId("");
    setViewName("");
  }, [portfolioId]);

  const symbols = useMemo(() => {
    const names = [
      ...(holdings?.map((holding) => holding.symbol) ?? []),
      ...(closed?.lots.map((lot) => lot.symbol) ?? []),
    ];
    return [...new Set(names)].sort();
  }, [holdings, closed]);

  const priceIds = series.filter((pick) => pick.id.startsWith("px:")).map((pick) => pick.id.slice(3));
  const priceQueries = useQueries({
    queries: priceIds.map((symbol) => ({
      queryKey: ["portfolio", portfolioId, "prices", symbol, range],
      queryFn: () => getHoldingPrices(portfolioId!, symbol, range),
      enabled: Boolean(portfolioId),
    })),
  });

  const spxLabel = performance?.usBenchmark === "^GSPC" ? "S&P 500" : "S&P 500 (TR)";

  const catalog = useMemo(() => {
    const builtIn = [
      {id: "portfolio", label: "Portfolio"},
      {id: "klci", label: "KLCI"},
      {id: "spx", label: spxLabel},
      {id: "underwater", label: "Drawdown"},
      {id: "vol", label: `Vol ${window}d`},
      {id: "beta", label: `Beta ${window}d`},
    ];
    return [...builtIn, ...symbols.map((symbol) => ({id: `px:${symbol}`, label: symbol}))];
  }, [spxLabel, symbols, window]);

  function pickFor(id: string) {
    return series.find((item) => item.id === id);
  }

  function toggle(id: string) {
    setSeries((current) => {
      const existing = current.find((item) => item.id === id);
      if (existing) return current.filter((item) => item.id !== id);
      const axis: ChartAxis = kind(id) === "level" ? "left" : "right";
      return [...current, {id, axis}];
    });
    setActiveViewId("");
  }

  function flipAxis(id: string) {
    setSeries((current) =>
      current.map((item) =>
        item.id === id ? {...item, axis: item.axis === "left" ? "right" : "left"} : item
      )
    );
    setActiveViewId("");
  }

  function saveView() {
    if (!portfolioId || !viewName.trim()) return;
    const next: ChartView = {
      id: crypto.randomUUID(),
      name: viewName.trim(),
      range,
      window,
      scale,
      series,
    };
    const stored = [...views, next];
    setViews(stored);
    writeChartViews(portfolioId, stored);
    setActiveViewId(next.id);
    setViewName("");
  }

  function applyView(id: string) {
    setActiveViewId(id);
    const view = views.find((item) => item.id === id);
    if (!view) return;
    setRange(view.range);
    setWindow(view.window);
    setScale(view.scale);
    setSeries(view.series);
  }

  function deleteView() {
    if (!portfolioId || !activeViewId) return;
    const stored = views.filter((item) => item.id !== activeViewId);
    setViews(stored);
    writeChartViews(portfolioId, stored);
    setActiveViewId("");
  }

  const chart = useMemo(() => {
    const priceBySymbol = new Map(
      priceQueries.flatMap((query) => (query.data ? [[query.data.symbol, query.data.series] as const] : []))
    );
    const levels = new Map<string, LevelPoint[]>();

    if (performance) {
      levels.set(
        "portfolio",
        performance.series.map((point) => ({date: point.date, value: point.value}))
      );
      levels.set(
        "klci",
        performance.klciSeries.map((point) => ({date: point.date, value: point.indexedValue}))
      );
      levels.set(
        "spx",
        performance.spxSeries.map((point) => ({date: point.date, value: point.indexedValue}))
      );
    }
    for (const [symbol, points] of priceBySymbol) {
      levels.set(
        `px:${symbol}`,
        points.map((point) => ({date: point.date, value: point.close}))
      );
    }

    const plotted = new Map<string, Map<string, number>>();
    for (const item of series) {
      const seriesKind = kind(item.id);
      let points: LevelPoint[] = [];
      if (seriesKind === "level") {
        points = rebase(levels.get(item.id) ?? [], scale);
      } else if (item.id === "underwater") {
        points = (risk?.underwater ?? []).map((point) => ({date: point.date, value: point.drawdown * 100}));
      } else if (item.id === "vol") {
        points = (risk?.rolling ?? []).map((point) => ({date: point.date, value: point.vol * 100}));
      } else {
        points = (risk?.rolling ?? []).map((point) => ({date: point.date, value: point.beta}));
      }
      plotted.set(item.id, new Map(points.map((point) => [point.date, point.value])));
    }

    const dates = [...new Set([...plotted.values()].flatMap((map) => [...map.keys()]))].sort();
    const rows = dates.map((date) => {
      const row: Record<string, string | number | null> = {date};
      for (const item of series) row[item.id] = plotted.get(item.id)?.get(date) ?? null;
      return row;
    });
    return rows;
  }, [performance, priceQueries, risk, scale, series]);

  if (!portfolioId) return null;

  const hasLeft = series.some((item) => item.axis === "left");
  const hasRight = series.some((item) => item.axis === "right");
  const isLoading = isPerformanceLoading || isRiskLoading;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Chart</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            {WINDOWS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setWindow(item);
                  setActiveViewId("");
                }}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  window === item
                    ? "bg-[var(--color-accent)] text-slate-900"
                    : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"
                }`}
              >
                {item}d
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {(
              [
                ["index", "Index 100"],
                ["change", "% change"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setScale(value);
                  setActiveViewId("");
                }}
                className={`rounded-md px-2.5 py-1 text-xs ${
                  scale === value
                    ? "bg-[var(--color-accent)] text-slate-900"
                    : "bg-[var(--color-surface)] text-[var(--color-text-muted)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <RangeChips
            value={range}
            onChange={(next) => {
              setRange(next);
              setActiveViewId("");
            }}
          />
        </div>
      </div>

      <p className="text-sm text-[var(--color-text-muted)]">
        Portfolio, indexes and prices share the scale. Drawdown, volatility and beta keep their own units, so leave those on the other axis. The window only moves vol and beta.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={activeViewId}
          onChange={(event) => applyView(event.target.value)}
          className="rounded-md border border-slate-600 bg-transparent px-2 py-1 text-sm"
        >
          <option value="">Saved views</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
        <input
          value={viewName}
          onChange={(event) => setViewName(event.target.value)}
          placeholder="Name this view"
          className="rounded-md border border-slate-600 bg-transparent px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={saveView}
          disabled={!viewName.trim()}
          className="rounded-md border border-slate-600 px-3 py-1 text-sm text-[var(--color-text-muted)] disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={deleteView}
          disabled={!activeViewId}
          className="rounded-md border border-slate-600 px-3 py-1 text-sm text-[var(--color-text-muted)] disabled:opacity-50"
        >
          Delete
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {catalog.map((item) => {
          const picked = pickFor(item.id);
          return (
            <div key={item.id} className="flex overflow-hidden rounded-md border border-slate-700">
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className={`px-2.5 py-1 text-xs ${
                  picked ? "bg-[var(--color-surface)] text-[var(--color-text)]" : "text-[var(--color-text-muted)]"
                }`}
              >
                {item.label}
              </button>
              {picked && (
                <button
                  type="button"
                  onClick={() => flipAxis(item.id)}
                  className="border-l border-slate-700 px-2 text-xs text-[var(--color-text-muted)]"
                  title={picked.axis === "left" ? "Left axis" : "Right axis"}
                >
                  {picked.axis === "left" ? "L" : "R"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl bg-[var(--color-surface)] p-5">
        {isLoading ? (
          <div className="h-80 animate-pulse rounded-xl bg-slate-800/40" />
        ) : chart.length < 2 || series.length === 0 ? (
          <div className="flex h-80 items-center justify-center text-sm text-[var(--color-text-muted)]">
            Turn on at least one series
          </div>
        ) : (
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{fill: "#94a3b8", fontSize: 12}}
                  tickFormatter={(value: string) => value.slice(5)}
                />
                {hasLeft && (
                  <YAxis
                    yAxisId="left"
                    tick={{fill: "#94a3b8", fontSize: 12}}
                    tickFormatter={(value: number) => value.toFixed(0)}
                  />
                )}
                {hasRight && (
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{fill: "#94a3b8", fontSize: 12}}
                    tickFormatter={(value: number) => value.toFixed(1)}
                  />
                )}
                <Tooltip
                  contentStyle={{backgroundColor: "#1e293b", border: "1px solid #334155"}}
                  labelStyle={{color: "#f1f5f9"}}
                  formatter={(value, name, item) => {
                    const id = String(item?.dataKey ?? "");
                    const numeric = Number(value);
                    const digits = kind(id) === "beta" ? 2 : 1;
                    return [numeric.toFixed(digits), String(name)];
                  }}
                />
                <Legend />
                {series.map((item, index) => (
                  <Line
                    key={item.id}
                    yAxisId={item.axis}
                    type="monotone"
                    dataKey={item.id}
                    name={catalog.find((row) => row.id === item.id)?.label ?? item.id}
                    stroke={COLORS[index % COLORS.length]}
                    dot={false}
                    strokeWidth={2}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </>
  );
}
