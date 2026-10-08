import type {AgentScore, AgentsOverview} from "../../types/api.types";
import {formatInterval, formatNumber, formatPct} from "../../utils/format";

const TARGET_LABEL: Record<string, string> = {
    returnScore: "Rank",
    probBeatMedian: "Beat median",
    volUplift: "Vol uplift",
    vol: "Volatility",
    probDrawdown: "Drawdown",
};

function formatExtra(extra: AgentScore["extras"][number]): string {
    if (extra.value == null) return "—";
    return extra.format === "pct" ? formatPct(extra.value, 1) : formatNumber(extra.value, 3);
}

function valueCell(score: AgentScore): string {
    if (score.value == null) return "—";
    const digits = 3;
    const interval = formatInterval(score.interval, (value) => formatNumber(value, digits));
    return interval ? `${formatNumber(score.value, digits)}  ${interval}` : formatNumber(score.value, digits);
}

export function ScoreboardTable({scores, agents}: {scores: AgentScore[]; agents: AgentsOverview["agents"]}) {
    const label = (score: AgentScore) => {
        const agent = agents.find((row) => row.version === score.version) ?? agents.find((row) => row.name === score.agent);
        return agent?.label ?? score.agent;
    };
    return (
        <div className="overflow-x-auto rounded-xl bg-[var(--color-surface)] p-5">
            <h2 className="text-sm font-medium">Scoreboard</h2>
            <p className="mb-4 text-xs text-[var(--color-text-muted)]">
                Out of sample. An IC of 0 is chance. A QLIKE gain of 0 is no better than last month's vol.
            </p>
            <table className="w-full text-sm">
                <thead className="text-left text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                    <tr>
                        <th className="pb-2 font-medium">Model</th>
                        <th className="pb-2 font-medium">Measure</th>
                        <th className="pb-2 text-right font-medium">Months</th>
                        <th className="pb-2 text-right font-medium">Value</th>
                        <th className="pb-2 text-right font-medium">t</th>
                        <th className="pb-2 font-medium">Baseline</th>
                    </tr>
                </thead>
                <tbody>
                    {scores.map((score) => (
                        <tr key={score.version} className="border-t border-[var(--color-line)] align-top">
                            <td className="py-3 pr-4">
                                <div className="font-medium">{label(score)}</div>
                                <div className="text-xs text-[var(--color-text-muted)]">
                                    {TARGET_LABEL[score.target] ?? score.target} · {score.horizon === "5d" ? "5 sessions" : "1 month"}
                                </div>
                                <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--color-text-muted)]">{score.verdict}</p>
                            </td>
                            <td className="py-3">
                                {score.metric}
                                <div className="text-xs text-[var(--color-text-muted)]">
                                    {score.from && score.to ? `${score.from} – ${score.to}` : "—"}
                                    {score.avgNames != null && ` · ${Math.round(score.avgNames)} names`}
                                </div>
                            </td>
                            <td className="py-3 text-right tabular-nums">{score.months}</td>
                            <td className="py-3 text-right tabular-nums whitespace-nowrap">{valueCell(score)}</td>
                            <td className="py-3 text-right tabular-nums">{score.tStat == null ? "—" : formatNumber(score.tStat)}</td>
                            <td className="py-3 text-xs">
                                <span className="text-[var(--color-text-muted)]">{score.baseline.label}</span>{" "}
                                {score.baseline.value == null ? "—" : formatNumber(score.baseline.value, 3)}
                                {score.target === "returnScore" && score.baseline.tStat != null && (
                                    <div className="text-[var(--color-text-muted)]">difference t {formatNumber(score.baseline.tStat)}</div>
                                )}
                                {score.extras.map((extra) => (
                                    <div key={extra.label} className="text-[var(--color-text-muted)]">
                                        {extra.label} {formatExtra(extra)}
                                    </div>
                                ))}
                            </td>
                        </tr>
                    ))}
                    {scores.length === 0 && (
                        <tr>
                            <td colSpan={6} className="py-6 text-sm text-[var(--color-text-muted)]">
                                Nothing in this view yet.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
