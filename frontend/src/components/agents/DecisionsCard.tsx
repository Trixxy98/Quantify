import type {AgentsOverview} from "../../types/api.types";
import {formatPctAbs} from "../../utils/format";

export function DecisionsCard({decisions}: {decisions: AgentsOverview["decisions"]}) {
    const rows = [...decisions.rows].sort((a, b) => b.weight - a.weight || a.symbol.localeCompare(b.symbol));
    return (
        <div className="overflow-x-auto rounded-xl bg-[var(--color-surface)] p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-medium">Decisions</h2>
                <p className="text-xs text-[var(--color-text-muted)]">
                    {decisions.month ?? "No month yet"}
                    {decisions.recorded ? " · recorded" : " · not recorded yet"}
                </p>
            </div>
            <p className="mb-4 text-xs text-[var(--color-text-muted)]">{decisions.notes[0]}</p>
            {rows.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No decision for this month.</p>
            ) : (
                <table className="w-full text-sm">
                    <thead className="text-left text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                        <tr>
                            <th className="pb-2 font-medium">Name</th>
                            <th className="pb-2 font-medium">Action</th>
                            <th className="pb-2 text-right font-medium">Weight</th>
                            <th className="pb-2 font-medium">Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.symbol} className="border-t border-[var(--color-line)] align-top">
                                <td className="py-2.5 pr-4 font-medium">{row.symbol}</td>
                                <td className="py-2.5 pr-4 capitalize text-[var(--color-text-muted)]">{row.action}</td>
                                <td className="py-2.5 pr-4 text-right tabular-nums">{formatPctAbs(row.weight, 1)}</td>
                                <td className="py-2.5 text-xs leading-relaxed text-[var(--color-text-muted)]">{row.reason}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
