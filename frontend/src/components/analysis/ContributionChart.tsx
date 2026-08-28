import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AttributionItem, Currency } from "../../types/api.types";
import { formatMoney } from "../../utils/format";

type Props = {
  items: AttributionItem[];
  currency: Currency;
  isLoading: boolean;
};

export function ContributionChart({ items, currency, isLoading }: Props) {
  if (isLoading) {
    return <div className="h-72 rounded-xl bg-[var(--color-surface)] animate-pulse" />;
  }

  if (items.length === 0) {
    return (
      <div className="h-72 rounded-xl bg-[var(--color-surface)] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        Not enough price history for this range
      </div>
    );
  }

  const chartData = [...items]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 8)
    .map((row) => ({
      symbol: row.symbol,
      contribution: row.contribution,
    }));

  const height = Math.max(240, chartData.length * 36);

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Contribution</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">P&amp;L over the selected range, in base currency</p>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="symbol"
              width={72}
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value) => formatMoney(Number(value), currency)}
              contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
              labelStyle={{ color: "#f1f5f9" }}
            />
            <Bar dataKey="contribution" radius={[0, 4, 4, 0]} maxBarSize={18}>
              {chartData.map((row) => (
                <Cell
                  key={row.symbol}
                  fill={row.contribution >= 0 ? "#22c55e" : "#ef4444"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
