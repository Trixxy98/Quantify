import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EventStudyOffset } from "../../types/api.types";
import { formatPctAbs } from "../../utils/format";

type Props = {
  offsets: EventStudyOffset[];
  eventCount: number;
};

export function EventCarChart({ offsets, eventCount }: Props) {
  const data = offsets.map((row) => ({
    offset: row.offset,
    aar: row.aar,
    acar: row.acar,
    upper: row.acar + 2 * row.acarSe,
    lower: row.acar - 2 * row.acarSe,
  }));

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Abnormal return around the event</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">
        Bars are the average abnormal return per day. The line is the cumulative average (CAR) across{" "}
        {eventCount} events, with a ±2 standard-error band — if the band straddles zero, the drift is noise.
      </p>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis
              dataKey="offset"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(value: number) => (value > 0 ? `+${value}` : String(value))}
            />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 12 }}
              tickFormatter={(value: number) => `${(value * 100).toFixed(1)}%`}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
              labelStyle={{ color: "#f1f5f9" }}
              formatter={(value, name) => [formatPctAbs(Number(value)), String(name)]}
              labelFormatter={(label) => `Day ${Number(label) > 0 ? `+${label}` : label}`}
            />
            <Legend />
            <ReferenceLine y={0} stroke="#475569" />
            <ReferenceLine x={0} stroke="#64748b" strokeDasharray="4 4" />
            <Bar dataKey="aar" name="Daily abnormal" maxBarSize={16}>
              {data.map((row) => (
                <Cell key={row.offset} fill={row.aar >= 0 ? "#22c55e" : "#ef4444"} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="acar" name="Cumulative (CAR)" stroke="#38bdf8" strokeWidth={2} dot={false} />
            <Line
              type="monotone"
              dataKey="upper"
              name="+2 s.e."
              stroke="#64748b"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="lower"
              name="-2 s.e."
              stroke="#64748b"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
