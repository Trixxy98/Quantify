import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EventStudyBucket, EventStudyStats } from "../../types/api.types";
import { formatPctAbs } from "../../utils/format";

type Props = {
  buckets: EventStudyBucket[];
  event: EventStudyStats;
  baseline: EventStudyStats;
};

function StatRow({ label, event, baseline }: { label: string; event: string; baseline: string }) {
  return (
    <tr className="border-t border-slate-700">
      <td className="py-1.5 text-[var(--color-text-muted)]">{label}</td>
      <td className="py-1.5 text-right tabular-nums">{event}</td>
      <td className="py-1.5 text-right tabular-nums text-[var(--color-text-muted)]">{baseline}</td>
    </tr>
  );
}

export function EventDistributionChart({ buckets, event, baseline }: Props) {
  const data = buckets.map((bucket) => ({
    label: `${(((bucket.from + bucket.to) / 2) * 100).toFixed(1)}%`,
    eventShare: bucket.eventShare,
    baselineShare: bucket.baselineShare,
  }));

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Conditional vs unconditional returns</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">
        Day-0 returns ({event.n} events) against every other day in the window ({baseline.n} days). Same
        axis, so a wider event distribution means the event pays you in volatility, not direction.
      </p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} interval={1} />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(value: number) => `${(value * 100).toFixed(0)}%`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
              labelStyle={{ color: "#f1f5f9" }}
              formatter={(value, name) => [formatPctAbs(Number(value), 1), String(name)]}
              labelFormatter={(label) => `Return near ${label}`}
            />
            <Legend />
            <Bar dataKey="baselineShare" name="Other days" fill="#475569" maxBarSize={22} />
            <Bar dataKey="eventShare" name="Event day" fill="#f59e0b" maxBarSize={22} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          <tr>
            <th className="pb-1 font-medium">Stat</th>
            <th className="pb-1 font-medium text-right">Event day</th>
            <th className="pb-1 font-medium text-right">Other days</th>
          </tr>
        </thead>
        <tbody>
          <StatRow label="Mean" event={formatPctAbs(event.mean)} baseline={formatPctAbs(baseline.mean)} />
          <StatRow label="Median" event={formatPctAbs(event.median)} baseline={formatPctAbs(baseline.median)} />
          <StatRow label="Std dev" event={formatPctAbs(event.sd)} baseline={formatPctAbs(baseline.sd)} />
          <StatRow label="5th pct" event={formatPctAbs(event.p05)} baseline={formatPctAbs(baseline.p05)} />
          <StatRow label="95th pct" event={formatPctAbs(event.p95)} baseline={formatPctAbs(baseline.p95)} />
          <StatRow label="Up days" event={formatPctAbs(event.hitRate, 1)} baseline={formatPctAbs(baseline.hitRate, 1)} />
        </tbody>
      </table>
    </div>
  );
}
