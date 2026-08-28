import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HoldingPriceSeries } from "../../types/api.types";
import { formatMoney } from "../../utils/format";

type Props = {
  data: HoldingPriceSeries | undefined;
  avgCost?: number;
  isLoading: boolean;
};

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
    date: point.date.slice(5),
    close: point.close,
  }));
  const showAvgCost = avgCost != null && Number.isFinite(avgCost) && avgCost > 0;

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-4">
        Price · {data.symbol}
      </h2>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              domain={["auto", "auto"]}
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
            {showAvgCost && (
              <ReferenceLine
                y={avgCost}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{ value: "Avg cost", fill: "#f59e0b", fontSize: 12 }}
              />
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
