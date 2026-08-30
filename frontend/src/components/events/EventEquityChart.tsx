import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EventStudy } from "../../types/api.types";
import { formatNumber, formatPct, formatPctAbs, toneClass } from "../../utils/format";

type Props = {
  backtest: EventStudy["backtest"];
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div>
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className={`text-sm font-medium tabular-nums ${tone !== undefined ? toneClass(tone) : ""}`}>{value}</p>
    </div>
  );
}

export function EventEquityChart({ backtest }: Props) {
  const { stats, equity, holdDays } = backtest;

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Event-only rule</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">
        Buy the close of day −1, sell the close of day +{holdDays}, {stats.trades} trades, in market{" "}
        {formatPctAbs(stats.timeInMarketPct, 1)} of the time. One path, no costs — the spread below matters more
        than the line.
      </p>
      <div className="h-56">
        {equity.length < 2 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Not enough trades to draw a curve</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={equity}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickFormatter={(value: string) => value.slice(2, 7)}
              />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                domain={["auto", "auto"]}
                tickFormatter={(value: number) => value.toFixed(0)}
              />
              <Tooltip
                contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
                labelStyle={{ color: "#f1f5f9" }}
                formatter={(value) => [formatNumber(Number(value), 1), "Equity"]}
              />
              <Line type="monotone" dataKey="value" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total return" value={formatPct(stats.totalReturn)} tone={stats.totalReturn} />
        <Stat label="Buy & hold" value={formatPct(stats.buyHoldReturn)} tone={stats.buyHoldReturn} />
        <Stat label="Mean trade" value={formatPct(stats.meanRet)} tone={stats.meanRet} />
        <Stat label="Median trade" value={formatPct(stats.medianRet)} tone={stats.medianRet} />
        <Stat label="Win rate" value={formatPctAbs(stats.winRate, 1)} />
        <Stat label="Best / worst" value={`${formatPct(stats.best)} / ${formatPct(stats.worst)}`} />
        <Stat label="Max drawdown" value={formatPct(stats.maxDrawdown)} tone={stats.maxDrawdown} />
        <Stat label="t-stat of mean" value={formatNumber(stats.tStat)} />
      </div>
    </div>
  );
}
