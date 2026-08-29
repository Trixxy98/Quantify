import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { IvSurfacePoint } from "../../types/api.types";
import { formatPctAbs } from "../../utils/format";

type Props = {
  points: IvSurfacePoint[];
  expiry: string;
};

function atmIv(rows: IvSurfacePoint[]): number | null {
  if (rows.length === 0) return null;
  return rows.reduce((best, row) =>
    Math.abs(row.moneyness - 1) < Math.abs(best.moneyness - 1) ? row : best
  ).iv;
}

export function IvSliceCharts({ points, expiry }: Props) {
  const skew = points
    .filter((p) => p.expiry === expiry)
    .sort((a, b) => a.moneyness - b.moneyness)
    .map((p) => ({moneyness: p.moneyness, iv: p.iv}));

  const expiries = [...new Set(points.map((p) => p.expiry))].sort();
  const term = expiries.map((date) => {
    const rows = points.filter((p) => p.expiry === date);
    const ttm = rows[0]?.ttm ?? 0;
    return {expiry: date, ttm, iv: atmIv(rows)};
  }).filter((row) => row.iv != null);

  const chartBox = "rounded-xl bg-[var(--color-surface)] p-5";
  const tooltip = {
    contentStyle: {backgroundColor: "#1e293b", border: "1px solid #334155"},
    labelStyle: {color: "#f1f5f9"},
  };

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div className={chartBox}>
        <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Skew · {expiry}</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">IV vs moneyness (K/S). OTM puts on the left, OTM calls on the right.</p>
        <div className="h-56">
          {skew.length < 2 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Not enough strikes for this expiry</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={skew}>
                <XAxis
                  dataKey="moneyness"
                  tick={{fill: "#94a3b8", fontSize: 12}}
                  tickFormatter={(v: number) => v.toFixed(2)}
                />
                <YAxis
                  tick={{fill: "#94a3b8", fontSize: 12}}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  {...tooltip}
                  formatter={(value) => [formatPctAbs(Number(value)), "IV"]}
                  labelFormatter={(label) => `K/S ${Number(label).toFixed(3)}`}
                />
                <Line type="monotone" dataKey="iv" name="IV" stroke="#38bdf8" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      <div className={chartBox}>
        <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Term structure · ATM</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">Closest-to-spot strike at each expiry.</p>
        <div className="h-56">
          {term.length < 2 ? (
            <p className="text-sm text-[var(--color-text-muted)]">Need more expiries</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={term}>
                <XAxis
                  dataKey="ttm"
                  tick={{fill: "#94a3b8", fontSize: 12}}
                  tickFormatter={(v: number) => `${v.toFixed(2)}y`}
                />
                <YAxis
                  tick={{fill: "#94a3b8", fontSize: 12}}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  {...tooltip}
                  formatter={(value) => [formatPctAbs(Number(value)), "ATM IV"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.expiry ?? ""}
                />
                <Line type="monotone" dataKey="iv" name="ATM IV" stroke="#a78bfa" dot strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
