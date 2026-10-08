import {AgentRunsCard} from "../components/agents/AgentRunsCard";
import {RecordedForecastsCard} from "../components/agents/RecordedForecastsCard";
import {ScoreboardTable} from "../components/agents/ScoreboardTable";
import {MetricCard} from "../components/dashboard/MetricCard";
import {useAgents} from "../hooks/useAgents";
import type {RecordedForecasts} from "../types/api.types";

const RECORDED_COPY: Record<string, {title: string; caption: string; format: "score" | "vol" | "prob"}> = {
    "technical|returnScore": {
        title: "Technical: next-month rank",
        caption: "Highest score first. The score is a rank forecast, not an expected return.",
        format: "score",
    },
    "quant|returnScore": {
        title: "Quant: implied edge",
        caption: "Loadings × trailing factor premia. Highest first. Baseline is zero.",
        format: "score",
    },
    "quant|probBeatMedian": {
        title: "Quant: P(beat median)",
        caption: "Probability next month beats the cross-section. Baseline is 50%.",
        format: "prob",
    },
    "event|returnScore": {
        title: "Event: mean abnormal return",
        caption: "Past event-day abnormal return for types scheduled next month.",
        format: "score",
    },
    "event|volUplift": {
        title: "Event: vol uplift",
        caption: "Mean absolute event-day move. Not an annualized vol.",
        format: "score",
    },
    "risk|vol": {
        title: "Risk: next-month vol",
        caption: "Annualized Garman–Klass vol, highest first.",
        format: "vol",
    },
    "risk|probDrawdown": {
        title: "Risk: P(drawdown ≤ −5%)",
        caption: "Market peak-to-trough inside the next month (SPY or ^GSPC).",
        format: "prob",
    },
};

function recordedCopy(row: RecordedForecasts) {
    return (
        RECORDED_COPY[`${row.agent}|${row.target}`] ?? {
            title: `${row.agent} · ${row.target}`,
            caption: `${row.horizon} horizon.`,
            format: "score" as const,
        }
    );
}

export default function AgentsPage() {
    const {data, isLoading, isError} = useAgents();
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
                    <p key={agent.version} className="text-sm text-[var(--color-danger)]">
                        {agent.label} ({agent.target}) failed validation and is left out: {agent.error}
                    </p>
                ))}

            {data && (
                <section className="grid gap-4 lg:grid-cols-2">
                    {data.recorded.map((row) => {
                        const copy = recordedCopy(row);
                        return (
                            <RecordedForecastsCard
                                key={`${row.agent}-${row.target}-${row.horizon}`}
                                title={copy.title}
                                caption={copy.caption}
                                recorded={row}
                                format={copy.format}
                            />
                        );
                    })}
                </section>
            )}

            {data?.agents.map((agent) => (
                <div key={agent.version} className="space-y-1">
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
