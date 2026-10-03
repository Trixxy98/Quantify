import basketFile from "../data/momentumBasket.json";
import {prisma} from "../lib/prisma";
import {latestSession} from "../jobs/marketSession";
import type {SyncTrigger} from "../jobs/sync.job";
import {toDateKey} from "../utils/dateRange";
import {loadDividends} from "./corporateActions";
import {getTrackedSymbols, syncDailyPrices} from "./market.service";
import {buildLevel} from "./momentum.service";
import {AGENTS, agentsDue, completedMonthEnd, runAgentSet} from "../research/agents/orchestrator";
import {scoreAgent, type AgentScore} from "../research/agents/scoreboard";
import {MIN_TRAIN_MONTHS} from "../research/agents/technical";
import type {AgentInput, AgentName, SymbolSeries} from "../research/agents/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_FROM = new Date("2015-01-01T00:00:00.000Z");
/** A run unfinished after this long is assumed dead, as for SyncRun. */
const AGENT_IN_FLIGHT_MS = 60 * 60 * 1000;
const REFRESH_WORKERS = 3;

const AGENT_INFO: Record<AgentName, {label: string; description: string}> = {
    technical: {
        label: "Technical",
        description: "Ranks next month's US returns from 1, 3 and 6-month returns, 12-1 momentum and distance from the 200-day mean.",
    },
    risk: {
        label: "Risk",
        description: "Forecasts next month's realized vol for every name, US and Bursa, from the last day, week and month of Garman–Klass variance.",
    },
};

export type AgentRunView = {
    agent: AgentName;
    asOf: string;
    trigger: string;
    modelVersion: string;
    startedAt: string;
    finishedAt: string | null;
    ok: boolean;
    error: string | null;
    rows: number;
};

export type RecordedForecasts = {
    agent: AgentName;
    asOf: string | null;
    recordedAt: string | null;
    liveMonths: number;
    rows: {symbol: string; value: number}[];
};

export type AgentsOverview = {
    asOf: string | null;
    universe: {symbols: number; us: number; bursa: number; basket: number; basketAsOf: string};
    agents: {name: AgentName; label: string; description: string; version: string; target: string; horizon: string; error: string | null; notes: string[]}[];
    runs: AgentRunView[];
    scoreboard: AgentScore[];
    recorded: RecordedForecasts[];
    headlines: {total: number; symbols: number; since: string | null; latest: string | null};
    notes: string[];
};

function toUtcDate(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
}

/** The dated basket plus every name held or traded in any portfolio. */
export async function agentUniverse(): Promise<string[]> {
    const tracked = await getTrackedSymbols();
    return [...new Set([...basketFile.symbols, ...tracked])].filter((symbol) => !symbol.startsWith("^")).sort();
}

async function usCalendar(): Promise<string[]> {
    const rows = await prisma.benchmarkPrice.findMany({
        where: {symbol: "^GSPC", date: {gte: HISTORY_FROM}},
        orderBy: {date: "asc"},
        select: {date: true},
    });
    return rows.map((row) => toDateKey(row.date));
}

export async function currentAsOf(now: Date): Promise<string | null> {
    return completedMonthEnd(await usCalendar(), latestSession(now, "US").date);
}

/**
 * Basket names are not synced daily, only when a page needs them. Before a
 * month-end pass, deepen any name that lacks history and bring stale ones up
 * to `through`.
 */
async function refreshUniverse(symbols: string[], through: string): Promise<string[]> {
    const spans = await prisma.dailyPrice.groupBy({
        by: ["symbol"],
        where: {symbol: {in: symbols}},
        _min: {date: true},
        _max: {date: true},
    });
    const bySymbol = new Map(spans.map((row) => [row.symbol, row]));
    const deepenBefore = HISTORY_FROM.getTime() + 31 * DAY_MS;
    const jobs: {symbol: string; from: Date}[] = [];
    for (const symbol of symbols) {
        const span = bySymbol.get(symbol);
        if (!span?._min.date || span._min.date.getTime() > deepenBefore) jobs.push({symbol, from: HISTORY_FROM});
        else if (toDateKey(span._max.date!) < through) jobs.push({symbol, from: new Date(span._max.date!.getTime() - 7 * DAY_MS)});
    }

    const failed: string[] = [];
    let next = 0;
    async function worker() {
        while (next < jobs.length) {
            const job = jobs[next++];
            await syncDailyPrices(job.symbol, job.from).catch((err) => {
                console.error("[agents] price refresh failed", job.symbol, err);
                failed.push(job.symbol);
            });
        }
    }
    await Promise.all(Array.from({length: Math.min(REFRESH_WORKERS, jobs.length)}, () => worker()));
    return failed;
}

/** Bars from 2015 through `asOf` with a dividend-reinvested level. Nothing after `asOf` is loaded. */
export async function loadAgentInput(asOf: string, symbols: string[]): Promise<AgentInput> {
    const [prices, dividends] = await Promise.all([
        prisma.dailyPrice.findMany({
            where: {symbol: {in: symbols}, date: {gte: HISTORY_FROM, lte: toUtcDate(asOf)}},
            orderBy: [{symbol: "asc"}, {date: "asc"}],
            select: {symbol: true, date: true, open: true, high: true, low: true, close: true},
        }),
        loadDividends(symbols),
    ]);
    const bars = new Map<string, typeof prices>();
    for (const price of prices) {
        const rows = bars.get(price.symbol) ?? [];
        rows.push(price);
        bars.set(price.symbol, rows);
    }

    const series: SymbolSeries[] = [];
    for (const [symbol, rows] of bars) {
        const dates = rows.map((row) => toDateKey(row.date));
        const close = rows.map((row) => Number(row.close));
        const income = (dividends.get(symbol) ?? []).map((row) => ({date: toDateKey(row.exDate), amount: row.amount}));
        series.push({
            symbol,
            market: symbol.endsWith(".KL") ? "BURSA" : "US",
            dates,
            open: rows.map((row) => Number(row.open)),
            high: rows.map((row) => Number(row.high)),
            low: rows.map((row) => Number(row.low)),
            close,
            level: buildLevel(dates.map((date, i) => ({date, close: close[i]})), income).map((point) => point.level),
        });
    }
    return {asOf, series};
}

let isAgentsRunning = false;

export type AgentsRunResult =
    | {ran: false; asOf: string | null; reason: string}
    | {ran: true; asOf: string; refreshFailed: string[]; agents: {agent: AgentName; ok: boolean; rows: number; error: string | null}[]};

/**
 * Month-end pass: every agent that has not yet succeeded for the latest
 * complete month runs once, and its forecasts for that month are recorded.
 * Safe to call daily; most days it finds nothing due.
 */
export async function runAgents(trigger: SyncTrigger, now = new Date()): Promise<AgentsRunResult> {
    if (isAgentsRunning) return {ran: false, asOf: null, reason: "an agent pass is already running"};
    isAgentsRunning = true;
    try {
        const asOf = await currentAsOf(now);
        if (!asOf) return {ran: false, asOf: null, reason: "no complete month in the ^GSPC calendar"};
        const asOfDate = toUtcDate(asOf);
        const previous = await prisma.agentRun.findMany({
            where: {asOf: asOfDate},
            select: {agent: true, ok: true, startedAt: true, finishedAt: true},
        });
        const due = agentsDue(AGENTS, previous, now, AGENT_IN_FLIGHT_MS);
        if (due.length === 0) return {ran: false, asOf, reason: `every agent already ran for ${asOf}`};

        const runs = await Promise.all(
            due.map((agent) => prisma.agentRun.create({data: {agent: agent.name, asOf: asOfDate, trigger, modelVersion: agent.version}}))
        );
        const fail = (error: string) =>
            Promise.all(runs.map((run) => prisma.agentRun.update({where: {id: run.id}, data: {finishedAt: new Date(), error}})));

        let input: AgentInput;
        let refreshFailed: string[];
        try {
            const symbols = await agentUniverse();
            refreshFailed = await refreshUniverse(symbols, asOf);
            input = await loadAgentInput(asOf, symbols);
        } catch (err) {
            const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
            await fail(`data load failed: ${message}`);
            throw err;
        }

        const results = runAgentSet(due, input);
        const summary: Extract<AgentsRunResult, {ran: true}>["agents"] = [];
        for (const [i, result] of results.entries()) {
            const run = runs[i];
            if (!result.ok) {
                await prisma.agentRun.update({where: {id: run.id}, data: {finishedAt: new Date(), error: result.error.slice(0, 500)}});
                summary.push({agent: result.agent, ok: false, rows: 0, error: result.error});
                continue;
            }
            const agent = due[i];
            const rows = result.live.map((row) => ({
                runId: run.id,
                agent: agent.name,
                symbol: row.symbol,
                asOf: asOfDate,
                horizon: agent.horizon,
                target: agent.target,
                value: row.forecast,
                modelVersion: agent.version,
            }));
            const [{count}] = await prisma.$transaction([
                prisma.agentForecast.createMany({data: rows, skipDuplicates: true}),
                prisma.agentRun.update({where: {id: run.id}, data: {finishedAt: new Date(), ok: true, rows: rows.length}}),
            ]);
            summary.push({agent: agent.name, ok: true, rows: count, error: null});
        }
        return {ran: true, asOf, refreshFailed, agents: summary};
    } finally {
        isAgentsRunning = false;
    }
}

function runView(run: {agent: string; asOf: Date; trigger: string; modelVersion: string; startedAt: Date; finishedAt: Date | null; ok: boolean; error: string | null; rows: number}): AgentRunView {
    return {
        agent: run.agent as AgentName,
        asOf: toDateKey(run.asOf),
        trigger: run.trigger,
        modelVersion: run.modelVersion,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
        ok: run.ok,
        error: run.error,
        rows: run.rows,
    };
}

async function recordedForecasts(agent: AgentName): Promise<RecordedForecasts> {
    const latest = await prisma.agentForecast.findFirst({where: {agent}, orderBy: {asOf: "desc"}, select: {asOf: true}});
    if (!latest) return {agent, asOf: null, recordedAt: null, liveMonths: 0, rows: []};
    const [rows, months] = await Promise.all([
        prisma.agentForecast.findMany({where: {agent, asOf: latest.asOf}, orderBy: {value: "desc"}, select: {symbol: true, value: true, createdAt: true}}),
        prisma.agentForecast.groupBy({by: ["asOf"], where: {agent}}),
    ]);
    return {
        agent,
        asOf: toDateKey(latest.asOf),
        recordedAt: rows[0]?.createdAt.toISOString() ?? null,
        liveMonths: months.length,
        rows: rows.map((row) => ({symbol: row.symbol, value: Number(row.value)})),
    };
}

async function headlineProgress(): Promise<AgentsOverview["headlines"]> {
    const [total, symbols, span] = await Promise.all([
        prisma.newsHeadline.count(),
        prisma.newsHeadline.groupBy({by: ["symbol"]}),
        prisma.newsHeadline.aggregate({_min: {recordedAt: true}, _max: {published: true}}),
    ]);
    return {
        total,
        symbols: symbols.length,
        since: span._min.recordedAt?.toISOString() ?? null,
        latest: span._max.published?.toISOString() ?? null,
    };
}

/** Scoreboard recomputed from stored prices (no Yahoo calls), plus the recorded live forecasts. */
export async function getAgentsOverview(now = new Date()): Promise<AgentsOverview> {
    const asOf = await currentAsOf(now);
    const symbols = await agentUniverse();
    const input = asOf ? await loadAgentInput(asOf, symbols) : null;
    const results = input ? runAgentSet(AGENTS, input) : [];

    const latestRuns = await Promise.all(
        AGENTS.map((agent) => prisma.agentRun.findFirst({where: {agent: agent.name}, orderBy: {startedAt: "desc"}}))
    );
    const [recorded, headlines] = await Promise.all([Promise.all(AGENTS.map((agent) => recordedForecasts(agent.name))), headlineProgress()]);

    const notes = [
        `Universe: the ${basketFile.symbols.length}-name basket dated ${basketFile.asOf} plus every name in any portfolio. Return-rank agents use the US names only; Bursa names have no factor data and too few peers for a cross-section.`,
        `Everything here is out of sample: each month is forecast by a model fitted only on months whose outcome was known beforehand, starting after ${MIN_TRAIN_MONTHS} months of training.`,
        "With about 70 test months, a mean IC needs to be roughly 0.035 or more to clear t = 2. Monthly t-stats use Newey–West (3 lags); intervals are the 5th–95th percentile of 2,000 stationary bootstrap resamples in 3-month blocks.",
        "The scoreboard is a backtest recomputed from stored prices. Recorded forecasts are the live record, written at each month end before the outcome is known, and are never edited.",
        "Headlines are recorded forward for the Sentiment agent (G3). It gets no weight until 12 scored months exist.",
    ];
    if (input) {
        const empty = symbols.filter((symbol) => !input.series.some((series) => series.symbol === symbol));
        if (empty.length > 0) notes.push(`No stored prices for ${empty.join(", ")}; the next month-end pass fetches them.`);
    }

    return {
        asOf,
        universe: {
            symbols: symbols.length,
            us: symbols.filter((symbol) => !symbol.endsWith(".KL")).length,
            bursa: symbols.filter((symbol) => symbol.endsWith(".KL")).length,
            basket: basketFile.symbols.length,
            basketAsOf: basketFile.asOf,
        },
        agents: AGENTS.map((agent) => {
            const result = results.find((row) => row.agent === agent.name);
            return {
                name: agent.name,
                ...AGENT_INFO[agent.name],
                version: agent.version,
                target: agent.target,
                horizon: agent.horizon,
                error: result && !result.ok ? result.error : null,
                notes: result?.ok ? result.output.notes : [],
            };
        }),
        runs: latestRuns.filter((run) => run != null).map(runView),
        scoreboard: results.flatMap((result) => (result.ok ? [scoreAgent(result.output)] : [])),
        recorded,
        headlines,
        notes,
    };
}
