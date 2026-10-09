import type {AgentsOverview} from "../../types/api.types";
import {formatNumber} from "../../utils/format";

const LABEL: Record<string, string> = {technical: "Technical", quant: "Quant", event: "Event", sentiment: "Sentiment"};

function cell(value: number | null): string {
    return value == null ? "—" : formatNumber(value, 2);
}

export function ForecastCorrelation({correlation}: {correlation: AgentsOverview["correlation"]}) {
    const agents = correlation.agents;
    const pair = (left: string, right: string) =>
        correlation.pairs.find((row) => (row.left === left && row.right === right) || (row.left === right && row.right === left));
    return (
        <div className="rounded-xl bg-[var(--color-surface)] p-5">
            <h2 className="text-sm font-medium">Forecast correlation</h2>
            <p className="mb-4 text-xs text-[var(--color-text-muted)]">
                Mean monthly Spearman correlation of the one-month return ranks. Near 1 means two agents are the same signal.
            </p>
            {agents.length < 2 ? (
                <p className="text-sm text-[var(--color-text-muted)]">Need two return agents before a correlation exists.</p>
            ) : (
                <table className="text-sm">
                    <thead className="text-left text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                        <tr>
                            <th className="pb-2 pr-6 font-medium" />
                            {agents.map((agent) => (
                                <th key={agent} className="pb-2 pr-6 text-right font-medium">
                                    {LABEL[agent] ?? agent}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {agents.map((row) => (
                            <tr key={row} className="border-t border-[var(--color-line)]">
                                <th className="py-2 pr-6 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                                    {LABEL[row] ?? row}
                                </th>
                                {agents.map((column) => {
                                    if (row === column) {
                                        return (
                                            <td key={column} className="py-2 pr-6 text-right tabular-nums text-[var(--color-text-muted)]">
                                                1.00
                                            </td>
                                        );
                                    }
                                    const match = pair(row, column);
                                    return (
                                        <td key={column} className="py-2 pr-6 text-right tabular-nums" title={match?.latestMonth ? `Latest ${match.latestMonth}: ${cell(match.latest)}` : undefined}>
                                            {cell(match?.mean ?? null)}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
