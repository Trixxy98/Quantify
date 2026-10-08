import type {AgentRunView, AgentsOverview} from "../../types/api.types";

function formatTime(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString() : "—";
}

function result(run: AgentRunView) {
    if (run.finishedAt == null) return "running or killed";
    if (run.ok) return <span className="text-[var(--color-accent)]">ok, {run.rows} forecasts</span>;
    return <span className="text-[var(--color-danger)]">{run.error ?? "failed"}</span>;
}

export function AgentRunsCard({agents, runs}: {agents: AgentsOverview["agents"]; runs: AgentRunView[]}) {
    return (
        <div className="rounded-xl bg-[var(--color-surface)] p-5 overflow-x-auto">
            <h2 className="mb-3 text-sm text-[var(--color-text-muted)]">Latest month-end pass</h2>
            <table className="w-full text-sm">
                <thead className="text-left text-[var(--color-text-muted)]">
                    <tr>
                        <th className="pb-2 font-medium">Agent</th>
                        <th className="pb-2 font-medium">Model</th>
                        <th className="pb-2 font-medium">As of</th>
                        <th className="pb-2 font-medium">Trigger</th>
                        <th className="pb-2 font-medium">Finished</th>
                        <th className="pb-2 font-medium">Result</th>
                    </tr>
                </thead>
                <tbody>
                    {agents.map((agent) => {
                        const run = runs.find((row) => row.modelVersion === agent.version);
                        return (
                            <tr key={agent.version} className="border-t border-slate-700">
                                <td className="py-1.5">
                                    {agent.label}
                                    <div className="text-xs text-[var(--color-text-muted)]">
                                        {agent.target} · {agent.horizon}
                                    </div>
                                </td>
                                <td className="py-1.5 text-[var(--color-text-muted)]">{run?.modelVersion ?? agent.version}</td>
                                <td className="py-1.5 tabular-nums">{run?.asOf ?? "—"}</td>
                                <td className="py-1.5">{run?.trigger ?? "—"}</td>
                                <td className="py-1.5 tabular-nums">{formatTime(run?.finishedAt ?? null)}</td>
                                <td className="py-1.5">
                                    {run ? result(run) : <span className="text-[var(--color-text-muted)]">not run yet</span>}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
