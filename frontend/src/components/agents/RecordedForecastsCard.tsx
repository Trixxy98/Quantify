import type {RecordedForecasts} from "../../types/api.types";
import {formatNumber, formatPctAbs} from "../../utils/format";

type Props = {
    title: string;
    caption: string;
    recorded: RecordedForecasts | undefined;
    format: "score" | "vol" | "prob";
};

export function RecordedForecastsCard({title, caption, recorded, format}: Props) {
    const rows = recorded?.rows ?? [];
    return (
        <div className="rounded-xl bg-[var(--color-surface)] p-5">
            <h2 className="text-sm font-medium">{title}</h2>
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                {recorded?.asOf
                    ? `Recorded for ${recorded.asOf} · ${recorded.liveMonths} live month${recorded.liveMonths === 1 ? "" : "s"} so far. ${caption}`
                    : "Nothing recorded yet. The first month-end pass writes these rows."}
            </p>
            {rows.length > 0 && (
                <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                        <thead className="text-left text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                            <tr>
                                <th className="pb-2 font-medium">#</th>
                                <th className="pb-2 font-medium">Symbol</th>
                                <th className="pb-2 font-medium text-right">
                                    {format === "vol" ? "Vol forecast" : format === "prob" ? "Probability" : "Score"}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr key={row.symbol} className="border-t border-[var(--color-line)]">
                                    <td className="py-1 text-[var(--color-text-muted)] tabular-nums">{index + 1}</td>
                                    <td className="py-1">{row.symbol}</td>
                                    <td className="py-1 text-right tabular-nums">
                                        {format === "score" ? formatNumber(row.value, 3) : formatPctAbs(row.value, 1)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
