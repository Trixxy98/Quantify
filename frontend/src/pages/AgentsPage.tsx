import {useMemo, useState} from "react";
import {AgentRunsCard} from "../components/agents/AgentRunsCard";
import {DecisionEquityChart} from "../components/agents/DecisionEquityChart";
import {DecisionsCard} from "../components/agents/DecisionsCard";
import {RecordedForecastsCard} from "../components/agents/RecordedForecastsCard";
import {ScoreboardTable} from "../components/agents/ScoreboardTable";
import {MetricCard} from "../components/dashboard/MetricCard";
import {useAgents} from "../hooks/useAgents";
import type {AgentsOverview, RecordedForecasts} from "../types/api.types";

const RECORDED_COPY: Record<string, {title: string; caption: string; format: "score" | "vol" | "prob"}> = {
    "technical|returnScore": {
        title: "Technical rank",
        caption: "Highest score first. A rank forecast, not an expected return.",
        format: "score",
    },
    "quant|returnScore": {
        title: "Quant implied edge",
        caption: "Loadings times trailing factor premia. Baseline is zero.",
        format: "score",
    },
    "quant|probBeatMedian": {
        title: "Quant beat-median",
        caption: "Probability of beating the cross-section. Baseline is 50%.",
        format: "prob",
    },
    "event|returnScore": {
        title: "Event abnormal return",
        caption: "Past event-day abnormal return for types in the window.",
        format: "score",
    },
    "event|volUplift": {
        title: "Event vol uplift",
        caption: "Mean absolute event-day move. Not an annualized vol.",
        format: "score",
    },
    "risk|vol": {
        title: "Risk vol",
        caption: "Annualized Garman–Klass vol, highest first.",
        format: "vol",
    },
    "risk|probDrawdown": {
        title: "Risk drawdown",
        caption: "Chance of a −5% peak-to-trough on SPY or ^GSPC.",
        format: "prob",
    },
};

const FAMILIES = [
    {id: "all", label: "All"},
    {id: "technical", label: "Technical"},
    {id: "quant", label: "Quant"},
    {id: "event", label: "Event"},
    {id: "risk", label: "Risk"},
] as const;

type Family = (typeof FAMILIES)[number]["id"];
type Horizon = "1m" | "5d";

function recordedCopy(row: RecordedForecasts) {
    const copy = RECORDED_COPY[`${row.agent}|${row.target}`] ?? {
        title: `${row.agent} · ${row.target}`,
        caption: `${row.horizon} horizon.`,
        format: "score" as const,
    };
    if (row.horizon !== "5d") return copy;
    return {...copy, title: `${copy.title} · 5 sessions`};
}

function Chip({active, onClick, children}: {active: boolean; onClick: () => void; children: string}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`rounded-md px-2.5 py-1 text-[13px] transition-colors ${
                active ? "bg-[var(--color-bg)] font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
        >
            {children}
        </button>
    );
}

function matches(agent: string, horizon: string, family: Family, selectedHorizon: Horizon) {
    return horizon === selectedHorizon && (family === "all" || agent === family);
}

export default function AgentsPage() {
    const {data, isLoading, isError} = useAgents();
    const [family, setFamily] = useState<Family>("all");
    const [horizon, setHorizon] = useState<Horizon>("1m");
    const liveMonths = data ? Math.max(0, ...data.recorded.map((row) => row.liveMonths)) : 0;

    const view = useMemo(() => {
        if (!data) return null;
        const agents = data.agents.filter((agent) => matches(agent.name, agent.horizon, family, horizon));
        const versions = new Set(agents.map((agent) => agent.version));
        return {
            agents,
            runs: data.runs.filter((run) => versions.has(run.modelVersion)),
            scores: data.scoreboard.filter((score) => versions.has(score.version)),
            recorded: data.recorded.filter((row) => matches(row.agent, row.horizon, family, horizon)),
            families: uniqueFamilies(data.agents).filter((agent) => family === "all" || agent.name === family),
        };
    }, [data, family, horizon]);

    return (
        <>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h2 className="text-lg font-semibold tracking-tight">Agents</h2>
                    <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
                        Statistical models with a public track record. One-month is the decision horizon. Five sessions is reported beside it.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="flex rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5">
                        {FAMILIES.map((item) => (
                            <Chip key={item.id} active={family === item.id} onClick={() => setFamily(item.id)}>
                                {item.label}
                            </Chip>
                        ))}
                    </div>
                    <div className="flex rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5">
                        <Chip active={horizon === "1m"} onClick={() => setHorizon("1m")}>
                            1 month
                        </Chip>
                        <Chip active={horizon === "5d"} onClick={() => setHorizon("5d")}>
                            5 sessions
                        </Chip>
                    </div>
                </div>
            </div>

            {isError && <p className="text-sm text-[var(--color-danger)]">Could not load the agents.</p>}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="As of" value={data?.asOf ?? "—"} hint="latest complete month" isLoading={isLoading} />
                <MetricCard
                    label="Universe"
                    value={data ? String(data.universe.symbols) : "—"}
                    hint={data ? `${data.universe.us} US · ${data.universe.bursa} Bursa` : undefined}
                    isLoading={isLoading}
                />
                <MetricCard label="Live months" value={data ? String(liveMonths) : "—"} hint="scored after each month ends" isLoading={isLoading} />
                <MetricCard
                    label="Headlines"
                    value={data ? String(data.headlines.total) : "—"}
                    hint={data?.headlines.since ? `${data.headlines.symbols} symbols` : "starts with the next sync"}
                    isLoading={isLoading}
                />
            </section>

            {data && <DecisionsCard decisions={data.decisions} />}
            {data && <DecisionEquityChart evaluation={data.evaluation} />}

            {view && view.families.length > 0 && (
                <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {view.families.map((agent) => (
                        <div key={agent.name} className="rounded-xl bg-[var(--color-surface)] p-4">
                            <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">{agent.label}</p>
                            <p className="mt-2 text-sm leading-relaxed text-[var(--color-text)]">{agent.description}</p>
                        </div>
                    ))}
                </section>
            )}

            {view && <ScoreboardTable scores={view.scores} agents={view.agents} />}
            {view && <AgentRunsCard agents={view.agents} runs={view.runs} />}

            {view?.agents
                .filter((agent) => agent.error)
                .map((agent) => (
                    <p key={agent.version} className="text-sm text-[var(--color-danger)]">
                        {agent.label} ({agent.target}) failed validation and is left out: {agent.error}
                    </p>
                ))}

            {view && view.recorded.length > 0 && (
                <section className="grid gap-4 lg:grid-cols-2">
                    {view.recorded.map((row) => {
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

            {data && <Notes data={data} />}
        </>
    );
}

function uniqueFamilies(agents: AgentsOverview["agents"]) {
    const seen = new Set<string>();
    return agents.filter((agent) => {
        if (seen.has(agent.name)) return false;
        seen.add(agent.name);
        return true;
    });
}

function Notes({data}: {data: AgentsOverview}) {
    const lines = [
        ...data.agents.flatMap((agent) =>
            agent.notes.map((note, index) => ({
                key: `${agent.version}-${index}`,
                text: `${agent.label} · ${agent.horizon}: ${note}`,
            })),
        ),
        ...data.notes.map((note, index) => ({key: `overview-${index}`, text: note})),
    ];
    if (lines.length === 0) return null;
    return (
        <details className="rounded-xl bg-[var(--color-surface)] p-5">
            <summary className="cursor-pointer text-sm font-medium">Methodology</summary>
            <div className="mt-3 space-y-2">
                {lines.map((line) => (
                    <p key={line.key} className="text-xs leading-relaxed text-[var(--color-text-muted)]">
                        {line.text}
                    </p>
                ))}
            </div>
        </details>
    );
}
