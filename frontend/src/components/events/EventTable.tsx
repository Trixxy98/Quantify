import type { EventStudyRow } from "../../types/api.types";
import { formatNumber, formatPct, toneClass } from "../../utils/format";

type Props = {
  events: EventStudyRow[];
  showSurprise: boolean;
  postDays: number;
};

export function EventTable({ events, showSurprise, postDays }: Props) {
  const rows = [...events].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="rounded-xl bg-[var(--color-surface)] p-5">
      <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Every event</h2>
      <p className="text-xs text-[var(--color-text-muted)] mb-4">
        Day 0 is the raw move, abnormal strips out beta × benchmark, and CAR runs to day +{postDays}. Alpha and
        beta are fitted before each event, so they differ row to row.
      </p>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[var(--color-surface)] text-left text-[var(--color-text-muted)]">
            <tr>
              <th className="pb-2 font-medium">Date</th>
              <th className="pb-2 font-medium">Symbol</th>
              <th className="pb-2 font-medium text-right">Day 0</th>
              <th className="pb-2 font-medium text-right">Abnormal</th>
              <th className="pb-2 font-medium text-right">CAR</th>
              {showSurprise && <th className="pb-2 font-medium text-right">EPS surprise</th>}
              <th className="pb-2 font-medium text-right">Beta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.symbol}-${row.date}`} className="border-t border-slate-700">
                <td className="py-2 tabular-nums">{row.date}</td>
                <td className="py-2 font-medium">{row.symbol}</td>
                <td className={`py-2 text-right tabular-nums ${toneClass(row.day0Return)}`}>
                  {formatPct(row.day0Return)}
                </td>
                <td className={`py-2 text-right tabular-nums ${toneClass(row.day0Abnormal)}`}>
                  {formatPct(row.day0Abnormal)}
                </td>
                <td className={`py-2 text-right tabular-nums ${toneClass(row.car)}`}>{formatPct(row.car)}</td>
                {showSurprise && (
                  <td className="py-2 text-right tabular-nums text-[var(--color-text-muted)]">
                    {row.surprisePercent != null ? formatPct(row.surprisePercent) : "—"}
                  </td>
                )}
                <td className="py-2 text-right tabular-nums">{formatNumber(row.beta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
