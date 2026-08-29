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
import type { PortfolioPerformance } from "../../types/api.types";

type Props = {
  data: PortfolioPerformance | undefined;
  isLoading: boolean;
};

function byDate(points: {date: string; indexedValue: number}[]) {
  return new Map(points.map((point) => [point.date, point.indexedValue]));
}

export function PerformanceChart({ data, isLoading }: Props) {
  if (isLoading) {
    return <div className="h-80 rounded-xl bg-[var(--color-surface)] animate-pulse" />;
  }

  if (!data || data.series.length < 2) {
    return (
      <div className="h-80 rounded-xl bg-[var(--color-surface)] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No performance data for this range
      </div>
    );
  }

  const klciByDate = byDate(data.klciSeries ?? []);
  const spxByDate = byDate(data.spxSeries ?? []);

  const chartData = data.series.map((point) => ({
    date: point.date,
    portfolio: point.value,
    klci: klciByDate.get(point.date) ?? null,
    spx: spxByDate.get(point.date) ?? null,
  }));

  const showKlci = chartData.some((row) => row.klci != null);
  const showSpx = chartData.some((row) => row.spx != null);

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)]">Performance</h2>
      <p className="text-xs text-[var(--color-text-muted)] mt-1 mb-4">
        Indexed to 100. Portfolio is time-weighted — adding a position does not look like a gain.
      </p>
      <div className="h-80">
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
              domain={["auto", "auto"]}
              tickFormatter={(value: number) => value.toFixed(0)}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
              labelStyle={{ color: "#f1f5f9" }}
              formatter={(value, name) => [Number(value).toFixed(1), String(name)]}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="portfolio"
              name="Portfolio"
              stroke="#22c55e"
              dot={false}
              strokeWidth={2}
            />
            {showKlci && (
              <Line
                type="monotone"
                dataKey="klci"
                name="KLCI"
                stroke="#38bdf8"
                dot={false}
                strokeWidth={2}
                connectNulls
              />
            )}
            {showSpx && (
              <Line
                type="monotone"
                dataKey="spx"
                name="S&P 500"
                stroke="#a78bfa"
                dot={false}
                strokeWidth={2}
                connectNulls
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
