import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { VariancePremium } from "../../types/api.types";
import { formatPct, formatPctAbs } from "../../utils/format";

type Props = {
  premium: VariancePremium;
};

export function EventPremiumChart({ premium }: Props) {
  const implied = premium.impliedMove;
  const data = premium.moves.map((row) => ({
    date: row.date,
    move: row.move,
  }));

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-1">What the straddle charges vs what happened</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">
        Each bar is the close-to-close move {premium.eventType === "EARNINGS" ? "across a past earnings date and the session after it" : `on a past ${premium.eventType} session`}
        {premium.stats.n > 0 ? ` (${premium.stats.n} events)` : ""}.
        {implied != null
          ? premium.method === "term-structure"
            ? ` The lines are the move the market assigns to ${premium.nextEvent ?? "the next event"}, ±${formatPctAbs(implied)}, from the variance between the ${premium.expiryBefore} and ${premium.expiry} expiries.`
            : ` The lines are today's at-the-money straddle to ${premium.expiry}, ±${formatPctAbs(implied)}, which covers ${premium.nextEvent ?? "the next event"} and every session up to expiry.`
          : " There is no live quote to draw."}{" "}
        Today's price against past realized moves; Yahoo keeps no old option marks, so this is not a backtest.
      </p>
      {data.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">No completed event sessions in this window.</p>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} minTickGap={24} />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 12 }}
                tickFormatter={(value: number) => `${(value * 100).toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                formatter={(value) => formatPct(Number(value))}
                labelFormatter={(label) => String(label)}
              />
              <Bar dataKey="move" name="Realized move">
                {data.map((row) => (
                  <Cell key={row.date} fill={row.move >= 0 ? "#22c55e" : "#ef4444"} />
                ))}
              </Bar>
              {implied != null && (
                <ReferenceLine y={implied} stroke="#38bdf8" strokeDasharray="4 4" label={{ value: "implied", fill: "#38bdf8", fontSize: 11 }} />
              )}
              {implied != null && <ReferenceLine y={-implied} stroke="#38bdf8" strokeDasharray="4 4" />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
