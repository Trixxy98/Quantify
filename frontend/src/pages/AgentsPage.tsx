import {AgentRunsCard} from "../components/agents/AgentRunsCard";
import {RecordedForecastsCard} from "../components/agents/RecordedForecastsCard";
import {ScoreboardTable} from "../components/agents/ScoreboardTable";
import {MetricCard} from "../components/dashboard/MetricCard";
import {useAgents} from "../hooks/useAgents";

export default function AgentsPage() {
    const {data, isLoading, isError} = useAgents();
    const recorded = (name: "technical" | "risk") => data?.recorded.find((row) => row.agent === name);
    const liveMonths = data ? Math.max(0, ...data.recorded.map((row) => row.liveMonths)) : 0;

    return (
        <>
            <div>
                <h2 className="text-sm font-medium text-[var(--color-text-muted)]">Agents</h2>
                <p className="mt-1 max-w-3xl text-xs text-[var(--color-text-muted)]">
                    Specialist forecasting models, each a statistical model with one job and a public track record. No language
                    model produces any number here. The question is which of them forecast anything out of sample.
                </p>
            </div>

            {isError && <p className="text-sm text-[var(--color-danger)]">Could not load the agents.</p>}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="As of" value={data?.asOf ?? "—"} hint="latest complete month" isLoading={isLoading} />
                <MetricCard
                    label="Universe"
                    value={data ? String(data.universe.symbols) : "—"}
                    hint={data ? `${data.universe.us} US, ${data.universe.bursa} Bursa; basket ${data.universe.basketAsOf}` : undefined}
                    isLoading={isLoading}
                />
                <MetricCard label="Live months recorded" value={data ? String(liveMonths) : "—"} hint="scored once each month ends" isLoading={isLoading} />
                <MetricCard
                    label="Headlines recorded"
                    value={data ? String(data.headlines.total) : "—"}
                    hint={
                        data?.headlines.since
                            ? `${data.headlines.symbols} symbols since ${new Date(data.headlines.since).toLocaleDateString()}`
                            : "starts with the next sync"
                    }
                    isLoading={isLoading}
                />
            </section>

            {data && <AgentRunsCard agents={data.agents} runs={data.runs} />}
            {data && <ScoreboardTable scores={data.scoreboard} agents={data.agents} />}

            {data?.agents
                .filter((agent) => agent.error)
                .map((agent) => (
                    <p key={agent.name} className="text-sm text-[var(--color-danger)]">
                        {agent.label} failed validation and is left out: {agent.error}
                    </p>
                ))}

            {data && (
                <section className="grid gap-4 lg:grid-cols-2">
                    <RecordedForecastsCard
                        title="Technical: next-month rank"
                        caption="Highest score first. The score is a rank forecast, not an expected return."
                        recorded={recorded("technical")}
                        format="score"
                    />
                    <RecordedForecastsCard
                        title="Risk: next-month vol"
                        caption="Annualized Garman–Klass vol, highest first."
                        recorded={recorded("risk")}
                        format="vol"
                    />
                </section>
            )}

            {data?.agents.map((agent) => (
                <div key={agent.name} className="space-y-1">
                    <p className="text-xs">
                        <span className="font-medium">{agent.label}</span>{" "}
                        <span className="text-[var(--color-text-muted)]">{agent.description}</span>
                    </p>
                    {agent.notes.map((note) => (
                        <p key={note} className="text-xs text-[var(--color-text-muted)]">· {note}</p>
                    ))}
                </div>
            ))}

            {data?.notes.map((note) => (
                <p key={note} className="text-xs text-[var(--color-text-muted)]">· {note}</p>
            ))}
        </>
    );
}
