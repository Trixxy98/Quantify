import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HoldingPriceSeries } from "../../types/api.types";
import { formatMoney, formatPct } from "../../utils/format";

type Props = {
  data: HoldingPriceSeries | undefined;
  avgCost?: number;
  isLoading: boolean;
};

type DrawdownSpan = {
  maxDD: number;
  peakDate: string;
  troughDate: string;
  peakClose: number;
  troughClose: number;
};

function maxDrawdownSpan(series: {date: string; close: number}[]): DrawdownSpan | null {
  let peak = -Infinity;
  let peakDate = series[0].date;
  let maxDD = 0;
  let spanPeakDate = series[0].date;
  let spanPeakClose = series[0].close;
  let troughDate = series[0].date;
  let troughClose = series[0].close;

  for (const point of series) {
    if (point.close > peak) {
      peak = point.close;
      peakDate = point.date;
    }
    if (peak <= 0) continue;
    const dd = (point.close - peak) / peak;
    if (dd < maxDD) {
      maxDD = dd;
      spanPeakDate = peakDate;
      spanPeakClose = peak;
      troughDate = point.date;
      troughClose = point.close;
    }
  }

  if (maxDD >= 0 || spanPeakDate === troughDate) return null;
  return {maxDD, peakDate: spanPeakDate, troughDate, peakClose: spanPeakClose, troughClose};
}

export function PriceChart({ data, avgCost, isLoading }: Props) {
  if (isLoading) {
    return <div className="h-72 rounded-xl bg-[var(--color-surface)] animate-pulse" />;
  }

  if (!data || data.series.length < 2) {
    return (
      <div className="h-72 rounded-xl bg-[var(--color-surface)] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No price data for this range — sync first
      </div>
    );
  }

  const chartData = data.series.map((point) => ({
    date: point.date,
    close: point.close,
  }));
  const showAvgCost = avgCost != null && Number.isFinite(avgCost) && avgCost > 0;
  const drawdown = maxDrawdownSpan(chartData);

  const closes = chartData.map((p) => p.close);
  let yMin = Math.min(...closes);
  let yMax = Math.max(...closes);
  if (showAvgCost) {
    yMin = Math.min(yMin, avgCost);
    yMax = Math.max(yMax, avgCost);
  }
  const pad = (yMax - yMin) * 0.08 || 1;

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)]">Price · {data.symbol}</h2>
      <p className="text-xs text-[var(--color-text-muted)] mt-1 mb-4">
        {showAvgCost ? `Avg cost ${formatMoney(avgCost, data.currency)}` : "Avg cost unavailable"}
        {drawdown
          ? ` · Max drawdown ${formatPct(drawdown.maxDD)} from ${drawdown.peakDate} to ${drawdown.troughDate}`
          : " · No drawdown in this range"}
      </p>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(value: string) => value.slice(5)}
            />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              domain={[yMin - pad, yMax + pad]}
              tickFormatter={(v: number) => Number(v).toFixed(2)}
              width={64}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
              labelStyle={{ color: "#f1f5f9" }}
              formatter={(value) => [
                formatMoney(Number(value), data.currency),
                "Close",
              ]}
            />
            <Legend />
            {drawdown && (
              <ReferenceArea
                x1={drawdown.peakDate}
                x2={drawdown.troughDate}
                fill="#ef4444"
                fillOpacity={0.12}
                ifOverflow="extendDomain"
              />
            )}
            {showAvgCost && (
              <ReferenceLine
                y={avgCost}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{ value: "Avg cost", fill: "#f59e0b", fontSize: 12 }}
              />
            )}
            {drawdown && (
              <>
                <ReferenceDot
                  x={drawdown.peakDate}
                  y={drawdown.peakClose}
                  r={4}
                  fill="#22c55e"
                  stroke="none"
                />
                <ReferenceDot
                  x={drawdown.troughDate}
                  y={drawdown.troughClose}
                  r={4}
                  fill="#ef4444"
                  stroke="none"
                />
              </>
            )}
            <Line
              type="monotone"
              dataKey="close"
              name="Close"
              stroke="#38bdf8"
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
