import type {AgentScore, AgentsOverview} from "../../types/api.types";
import {formatInterval, formatNumber, formatPct} from "../../utils/format";

function formatExtra(extra: AgentScore["extras"][number]): string {
    if (extra.value == null) return "—";
    return extra.format === "pct" ? formatPct(extra.value, 1) : formatNumber(extra.value, 3);
}

function valueCell(score: AgentScore): string {
    if (score.value == null) return "—";
    const digits = 3;
    const interval = formatInterval(score.interval, (value) => formatNumber(value, digits));
    return interval ? `${formatNumber(score.value, digits)} · ${interval}` : formatNumber(score.value, digits);
}

export function ScoreboardTable({scores, agents}: {scores: AgentScore[]; agents: AgentsOverview["agents"]}) {
    const label = (score: AgentScore) => {
        const agent = agents.find((row) => row.version === score.version) ?? agents.find((row) => row.name === score.agent);
        const name = agent?.label ?? score.agent;
        return `${name} · ${score.target}${score.horizon === "5d" ? " · 5d" : ""}`;
    };
    return (
        <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
            <h2 className="mb-1 text-sm text-[var(--color-text-muted)]">Scoreboard, out of sample</h2>
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">
                Zero means no skill on both measures: an IC of 0 ranks no better than chance, a QLIKE gain of 0 is no better than
                carrying last month's vol forward.
            </p>
            <table className="w-full text-sm">
                <thead className="text-left text-[var(--color-text-muted)]">
                    <tr>
                        <th className="pb-2 font-medium">Agent</th>
                        <th className="pb-2 font-medium">Measure</th>
                        <th className="pb-2 font-medium text-right">Months</th>
                        <th className="pb-2 font-medium text-right">Value</th>
                        <th className="pb-2 font-medium text-right">t</th>
                        <th className="pb-2 font-medium">Baseline</th>
                        <th className="pb-2 font-medium">Also</th>
                    </tr>
                </thead>
                <tbody>
                    {scores.map((score) => (
                        <tr key={score.version} className="border-t border-slate-700 align-top">
                            <td className="py-2">
                                {label(score)}
                                <div className="text-xs text-[var(--color-text-muted)]">{score.version}</div>
                            </td>
                            <td className="py-2">
                                {score.metric}
                                <div className="text-xs text-[var(--color-text-muted)]">
                                    {score.from && score.to ? `${score.from} to ${score.to}` : "—"}
                                    {score.avgNames != null && ` · ${Math.round(score.avgNames)} names`}
                                </div>
                            </td>
                            <td className="py-2 text-right tabular-nums">{score.months}</td>
                            <td className="py-2 text-right tabular-nums whitespace-nowrap">{valueCell(score)}</td>
                            <td className="py-2 text-right tabular-nums">{score.tStat == null ? "—" : formatNumber(score.tStat)}</td>
                            <td className="py-2 text-xs">
                                {score.baseline.label}: {score.baseline.value == null ? "—" : formatNumber(score.baseline.value, 3)}
                                {score.target === "returnScore" && score.baseline.tStat != null && (
                                    <div className="text-[var(--color-text-muted)]">difference t = {formatNumber(score.baseline.tStat)}</div>
                                )}
                            </td>
                            <td className="py-2 text-xs">
                                {score.extras.map((extra) => (
                                    <div key={extra.label}>
                                        <span className="text-[var(--color-text-muted)]">{extra.label}:</span> {formatExtra(extra)}
                                    </div>
                                ))}
                            </td>
                        </tr>
                    ))}
                    {scores.length > 0 && (
                        <tr>
                            <td colSpan={7} className="pt-3">
                                {scores.map((score) => (
                                    <p key={score.version} className="text-xs">
                                        <span className="font-medium">{label(score)}.</span> {score.verdict}
                                    </p>
                                ))}
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
