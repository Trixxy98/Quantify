import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { PortfolioAllocation } from "../../types/api.types";
import { formatPctAbs } from "../../utils/format";

const COLORS = ["#22c55e", "#38bdf8", "#f59e0b", "#a78bfa", "#f43f5e", "#14b8a6"];

type Props = {
  data: PortfolioAllocation | undefined;
  isLoading: boolean;
};

export function AllocationChart({ data, isLoading }: Props) {
  if (isLoading) {
    return <div className="h-72 rounded-xl bg-[var(--color-surface)] animate-pulse" />;
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="h-72 rounded-xl bg-[var(--color-surface)] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
        No holdings to chart
      </div>
    );
  }

  const chartData = data.items.map((item) => ({
    name: item.symbol,
    value: item.marketValue,
    percentage: item.percentage,
  }));

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-4">Allocation</h2>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}>
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={COLORS[chartData.indexOf(entry) % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(_value, _name, item) => formatPctAbs(item.payload.percentage)}
              contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}