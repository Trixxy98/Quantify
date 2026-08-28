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
  
  export function PerformanceChart({ data, isLoading }: Props) {
    if (isLoading) {
      return <div className="h-72 rounded-xl bg-[var(--color-surface)] animate-pulse" />;
    }
  
    if (!data || data.series.length < 2) {
      return (
        <div className="h-72 rounded-xl bg-[var(--color-surface)] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
          No performance data for this range
        </div>
      );
    }
  
    const start = data.series[0].value;
    const benchByDate = new Map(data.benchmarkSeries.map((p) => [p.date, p.indexedValue]));
  
    const chartData = data.series.map((point) => ({
      date: point.date.slice(5),
      portfolio: start > 0 ? (point.value / start) * 100 : 100,
      benchmark: benchByDate.get(point.date) ?? null,
    }));
  
    return (
      <div className="rounded-xl bg-[var(--color-surface)] p-5">
        <h2 className="text-sm text-[var(--color-text-muted)] mb-4">Performance</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 12 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 12 }} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
                labelStyle={{ color: "#f1f5f9" }}
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
              <Line
                type="monotone"
                dataKey="benchmark"
                name="Benchmark"
                stroke="#94a3b8"
                dot={false}
                strokeWidth={2}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }