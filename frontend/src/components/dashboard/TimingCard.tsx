import type {TimingSummary} from "../../types/api.types";
import {formatNumber, toneClass} from "../../utils/format";

const HORIZON: Record<TimingSummary["rows"][number]["horizon"], string> = {
    sameDay: "Same-day close",
    sessions5: "5 sessions later",
    sessions20: "20 sessions later",
};

function bps(value: number | null): string {
    if (value == null) return "—";
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatNumber(value, 0)}`;
}

export function TimingCard({timing}: {timing: TimingSummary | undefined}) {
    if (!timing) return null;
    return (
        <div className="rounded-xl bg-[var(--color-surface)] p-5">
            <h2 className="text-sm font-medium">Fill timing</h2>
            <p className="mb-4 text-xs text-[var(--color-text-muted)]">
                Basis points from the fill to the close. A later rise is a gain on a buy and a cost on a sell. {timing.note}
            </p>
            <table className="w-full text-sm">
                <thead className="text-left text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                    <tr>
                        <th className="pb-2 font-medium">Side</th>
                        <th className="pb-2 font-medium">Versus</th>
                        <th className="pb-2 text-right font-medium">n</th>
                        <th className="pb-2 text-right font-medium">Mean</th>
                        <th className="pb-2 text-right font-medium">Median</th>
                    </tr>
                </thead>
                <tbody>
                    {timing.rows.map((row) => (
                        <tr key={`${row.side}-${row.horizon}`} className="border-t border-[var(--color-line)]">
                            <td className="py-2">{row.side}</td>
                            <td className="py-2 text-[var(--color-text-muted)]">{HORIZON[row.horizon]}</td>
                            <td className="py-2 text-right tabular-nums">{row.n}</td>
                            <td className={`py-2 text-right tabular-nums ${row.meanBps == null ? "" : toneClass(row.meanBps)}`}>{bps(row.meanBps)}</td>
                            <td className={`py-2 text-right tabular-nums ${row.medianBps == null ? "" : toneClass(row.medianBps)}`}>{bps(row.medianBps)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
