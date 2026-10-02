import {Fragment} from "react";
import type {DataHealthRow} from "../../types/api.types";
import {StatusBadge} from "./StatusBadge";

const KIND_LABELS: Record<DataHealthRow["kind"], string> = {
    holding: "Traded",
    benchmark: "Benchmark",
    fx: "FX",
    options: "Options only",
};

function count(value: number | null | undefined, flagged = false) {
    if (value == null) return "—";
    return <span className={flagged && value > 0 ? "text-amber-400" : undefined}>{value}</span>;
}

export function HealthTable({rows}: {rows: DataHealthRow[]}) {
    return (
        <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
            <h2 className="text-sm text-[var(--color-text-muted)] mb-1">Series</h2>
            <p className="text-xs text-[var(--color-text-muted)] mb-4">
                Behind and missing are counted in exchange sessions. Dividends and splits show how many are stored; a
                flagged one is listed under the row.
            </p>
            <table className="w-full text-sm">
                <thead className="text-left text-[var(--color-text-muted)]">
                    <tr>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Series</th>
                        <th className="pb-2 font-medium">Kind</th>
                        <th className="pb-2 font-medium text-right">Bars</th>
                        <th className="pb-2 font-medium">Last bar</th>
                        <th className="pb-2 font-medium text-right">Behind</th>
                        <th className="pb-2 font-medium text-right">Missing</th>
                        <th className="pb-2 font-medium text-right">Splits</th>
                        <th className="pb-2 font-medium text-right">Dividends</th>
                        <th className="pb-2 font-medium text-right">IV rows</th>
                        <th className="pb-2 font-medium">Last IV</th>
                        <th className="pb-2 font-medium text-right">IV missed</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row) => {
                        const hasPrices = row.kind !== "options";
                        return (
                            <Fragment key={row.symbol}>
                                <tr className="border-t border-slate-700">
                                    <td className="py-1.5"><StatusBadge status={row.status} /></td>
                                    <td className="py-1.5 font-medium">{row.symbol}</td>
                                    <td className="py-1.5 text-[var(--color-text-muted)]">
                                        {KIND_LABELS[row.kind]}
                                        {row.market ? ` · ${row.market === "US" ? "US" : "Bursa"}` : ""}
                                    </td>
                                    <td className="py-1.5 text-right tabular-nums">{hasPrices ? row.bars : "—"}</td>
                                    <td className="py-1.5 tabular-nums">{row.lastDate ?? "—"}</td>
                                    <td className="py-1.5 text-right tabular-nums">{count(row.staleSessions, true)}</td>
                                    <td className="py-1.5 text-right tabular-nums">{hasPrices ? count(row.missingSessions, true) : "—"}</td>
                                    <td className="py-1.5 text-right tabular-nums">{row.kind === "holding" ? row.splits : "—"}</td>
                                    <td className="py-1.5 text-right tabular-nums">{row.kind === "holding" ? row.dividends : "—"}</td>
                                    <td className="py-1.5 text-right tabular-nums">{row.iv ? row.iv.recorded : "—"}</td>
                                    <td className="py-1.5 tabular-nums">{row.iv?.lastDate ?? "—"}</td>
                                    <td className="py-1.5 text-right tabular-nums">{row.iv ? count(row.iv.missed, true) : "—"}</td>
                                </tr>
                                {row.issues.length > 0 && (
                                    <tr>
                                        <td />
                                        <td colSpan={11} className="pb-2 text-xs text-[var(--color-text-muted)]">
                                            {row.issues.map((issue) => (
                                                <p key={issue}>· {issue}</p>
                                            ))}
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
