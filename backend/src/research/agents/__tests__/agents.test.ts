import {describe, expect, it} from "vitest";
import {ridge} from "../../ridge";
import {expandingFolds} from "../../walkForward";
import {symbolMonths, shiftMonth, monthDistance} from "../monthly";
import {agentsDue, completedMonthEnd, runAgentSet} from "../orchestrator";
import {fitHar, harForecast, harRows, runRiskVol, riskVolAgent, type HarRegressors} from "../riskVol";
import {scoreReturnAgent, scoreVolAgent} from "../scoreboard";
import {neweyWestMean, qlike, rankScore, ranks, spearman} from "../scoring";
import {runTechnical, technicalAgent, technicalFeatures} from "../technical";
import type {Agent, AgentInput, AgentOutput, AgentPrediction} from "../types";
import {seededRandom} from "../../bootstrap";
import {syntheticInput} from "./synthetic";

/** About 100 months: 13 of warm-up, 60 of training, the rest out of sample. */
const SESSIONS = 2100;

function perturbAfter(input: AgentInput, month: string): AgentInput {
    return {
        asOf: input.asOf,
        series: input.series.map((series) => {
            const feature = symbolMonths(series).get(month)!.feature;
            const bump = (values: number[], scale: number) =>
                values.map((value, i) => (i > feature ? value * (1 + scale * Math.sin(i)) : value));
            return {...series, high: bump(series.high, 0.05), level: bump(series.level, 0.2)};
        }),
    };
}

function shiftOneSession(input: AgentInput): AgentInput {
    const lag = (values: number[]) => values.map((value, i) => (i === 0 ? value : values[i - 1]));
    return {
        asOf: input.asOf,
        series: input.series.map((series) => ({
            ...series,
            open: lag(series.open),
            high: lag(series.high),
            low: lag(series.low),
            close: lag(series.close),
            level: lag(series.level),
        })),
    };
}

function forecastsUpTo(predictions: AgentPrediction[], month: string): Map<string, number> {
    return new Map(predictions.filter((row) => row.month <= month).map((row) => [`${row.month}|${row.symbol}`, row.forecast]));
}

describe("scoring", () => {
    it("averages ranks over ties", () => {
        expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
    });

    it("gives IC 1 for a perfect ranking, -1 reversed, about 0 on noise", () => {
        const a = [0.1, -0.2, 0.05, 0.3, -0.1];
        expect(spearman(a, a.map((value) => value * 7 + 1))).toBeCloseTo(1, 12);
        expect(spearman(a, a.map((value) => -value))).toBeCloseTo(-1, 12);
        const random = seededRandom(3);
        const x = Array.from({length: 4000}, () => random());
        const y = Array.from({length: 4000}, () => random());
        expect(Math.abs(spearman(x, y))).toBeLessThan(0.05);
    });

    it("scales rank scores to [-0.5, 0.5]", () => {
        expect(rankScore([3, 1, 2])).toEqual([0.5, -0.5, 0]);
    });

    it("QLIKE is zero for a perfect variance forecast and positive otherwise", () => {
        expect(qlike(0.04, 0.04)).toBeCloseTo(0, 12);
        expect(qlike(0.04, 0.02)).toBeGreaterThan(0);
        expect(qlike(0.04, 0.08)).toBeGreaterThan(0);
    });

    it("Newey–West mean of a constant plus noise is the constant", () => {
        const random = seededRandom(5);
        const series = Array.from({length: 500}, () => 0.02 + (random() - 0.5) * 0.01);
        const stats = neweyWestMean(series, 3)!;
        expect(stats.mean).toBeCloseTo(0.02, 3);
        expect(stats.tStat).toBeGreaterThan(10);
    });
});

describe("ridge", () => {
    const random = seededRandom(9);
    const x = Array.from({length: 200}, () => [random() - 0.5, random() - 0.5, random() - 0.5]);
    const y = x.map((row) => 2 * row[0] - row[1] + 0.5 * row[2]);

    it("recovers the coefficients without a penalty", () => {
        const beta = ridge(x, y, 0);
        expect(beta[0]).toBeCloseTo(2, 8);
        expect(beta[1]).toBeCloseTo(-1, 8);
        expect(beta[2]).toBeCloseTo(0.5, 8);
    });

    it("shrinks toward zero as the penalty grows", () => {
        const norm = (beta: number[]) => Math.hypot(...beta);
        expect(norm(ridge(x, y, 1))).toBeLessThan(norm(ridge(x, y, 0.01)));
        expect(norm(ridge(x, y, 1e6))).toBeLessThan(1e-4);
    });
});

describe("expandingFolds", () => {
    it("starts every fold at zero and keeps a short last fold", () => {
        expect(expandingFolds(11, 4, 3)).toEqual([
            {trainStart: 0, trainEnd: 4, testStart: 4, testEnd: 7},
            {trainStart: 0, trainEnd: 7, testStart: 7, testEnd: 10},
            {trainStart: 0, trainEnd: 10, testStart: 10, testEnd: 11},
        ]);
        expect(expandingFolds(4, 4, 3)).toEqual([]);
    });
});

describe("month helpers", () => {
    it("shifts across year ends and measures distance", () => {
        expect(shiftMonth("2026-01", -1)).toBe("2025-12");
        expect(shiftMonth("2025-11", 3)).toBe("2026-02");
        expect(monthDistance("2025-11", "2026-02")).toBe(3);
    });
});

describe("completedMonthEnd", () => {
    it("accepts the last stored month when its bar is the last weekday and that session closed", () => {
        expect(completedMonthEnd(["2026-09-29", "2026-09-30"], "2026-10-02")).toBe("2026-09-30");
        expect(completedMonthEnd(["2026-05-28", "2026-05-29"], "2026-06-01")).toBe("2026-05-29");
    });

    it("rejects a month-end bar stored before that session closed", () => {
        expect(completedMonthEnd(["2026-08-31", "2026-09-29", "2026-09-30"], "2026-09-29")).toBe("2026-08-31");
    });

    it("falls back to the previous month when the last month is unfinished or stale", () => {
        expect(completedMonthEnd(["2026-08-31", "2026-09-30", "2026-10-01", "2026-10-02"], "2026-10-02")).toBe("2026-09-30");
        expect(completedMonthEnd(["2026-08-28", "2026-08-31", "2026-09-25"], "2026-10-02")).toBe("2026-08-31");
        expect(completedMonthEnd(["2026-09-25"], "2026-10-02")).toBeNull();
        expect(completedMonthEnd([], "2026-10-02")).toBeNull();
    });
});

describe("technical agent", () => {
    const input = syntheticInput({names: 12, sessions: SESSIONS, seed: 11});
    const output = runTechnical(input);
    const months = [...new Set(output.predictions.map((row) => row.month))].sort();
    const middle = months[Math.floor(months.length / 2)];

    it("reads inputs the session before the month end, never the month-end close", () => {
        const series = input.series[0];
        const months = symbolMonths(series);
        const month = [...months.keys()][40];
        const end = months.get(month)!;
        const before = technicalFeatures(series, months, month);
        const atClose = {...series, level: series.level.map((value, i) => (i === end.index ? value * 1.5 : value))};
        expect(technicalFeatures(atClose, months, month)).toEqual(before);
        const atFeature = {...series, level: series.level.map((value, i) => (i === end.feature ? value * 1.5 : value))};
        expect(technicalFeatures(atFeature, months, month)).not.toEqual(before);
    });

    it("forecasts only out of sample, from the 61st usable month", () => {
        expect(months.length).toBeGreaterThan(5);
        expect(output.predictions.filter((row) => row.month === months[months.length - 1]).every((row) => row.realized == null)).toBe(true);
    });

    it("future prices never change a forecast", () => {
        const after = runTechnical(perturbAfter(input, middle));
        const a = forecastsUpTo(output.predictions, middle);
        const b = forecastsUpTo(after.predictions, middle);
        expect(b.size).toBe(a.size);
        for (const [key, value] of a) expect(b.get(key)).toBeCloseTo(value, 12);
    });

    it("prices moved one session later do change the forecast", () => {
        const shifted = runTechnical(shiftOneSession(input));
        const a = forecastsUpTo(output.predictions, middle);
        const b = forecastsUpTo(shifted.predictions, middle);
        const changed = [...a].some(([key, value]) => b.has(key) && Math.abs(b.get(key)! - value) > 1e-9);
        expect(changed).toBe(true);
    });

    it("finds ranking skill when past returns do predict the next month", () => {
        const trending = runTechnical(syntheticInput({names: 20, sessions: SESSIONS, seed: 4, persistentDrift: true}));
        const score = scoreReturnAgent(trending);
        expect(score.months).toBeGreaterThan(12);
        expect(score.value!).toBeGreaterThan(0.1);
        expect(score.tStat!).toBeGreaterThan(2);
        expect(score.verdict).toContain("Evidence of ranking skill");
    });
});

describe("risk agent (HAR vol)", () => {
    it("recovers known HAR coefficients", () => {
        const random = seededRandom(21);
        const samples = Array.from({length: 400}, () => {
            const x: HarRegressors = [random() * 4e-4, random() * 4e-4, random() * 4e-4];
            const y = 2e-5 + 0.1 * x[0] + 0.3 * x[1] + 0.5 * x[2] + (random() - 0.5) * 1e-7;
            return {x, y};
        });
        const fit = fitHar(samples)!;
        expect(fit.beta[0]).toBeCloseTo(2e-5, 6);
        expect(fit.beta[1]).toBeCloseTo(0.1, 2);
        expect(fit.beta[2]).toBeCloseTo(0.3, 2);
        expect(fit.beta[3]).toBeCloseTo(0.5, 2);
        expect(harForecast(fit, [0, 0, 0])).toBeGreaterThanOrEqual(fit.floor);
    });

    it("estimates on daily rows whose outcome spans the next 22 sessions", () => {
        const series = syntheticInput({names: 1, sessions: 300, seed: 2}).series[0];
        const rows = harRows(series);
        expect(rows.length).toBe(300 - 21 - 22);
        expect(rows.every((row) => row.targetEnd < series.dates.length)).toBe(true);
    });

    const input = syntheticInput({names: 6, sessions: SESSIONS, seed: 13});
    const output = runRiskVol(input);
    const months = [...new Set(output.predictions.map((row) => row.month))].sort();
    const middle = months[Math.floor(months.length / 2)];

    it("emits positive vol forecasts with the newest month unscored", () => {
        expect(output.predictions.length).toBeGreaterThan(0);
        expect(output.predictions.every((row) => row.forecast > 0)).toBe(true);
        const last = months[months.length - 1];
        expect(output.predictions.filter((row) => row.month === last).every((row) => row.realized == null)).toBe(true);
    });

    it("future bars never change a forecast", () => {
        const after = runRiskVol(perturbAfter(input, middle));
        const a = forecastsUpTo(output.predictions, middle);
        const b = forecastsUpTo(after.predictions, middle);
        expect(b.size).toBe(a.size);
        for (const [key, value] of a) expect(b.get(key)).toBeCloseTo(value, 12);
    });

    it("bars moved one session later do change the forecast", () => {
        const shifted = runRiskVol(shiftOneSession(input));
        const a = forecastsUpTo(output.predictions, middle);
        const b = forecastsUpTo(shifted.predictions, middle);
        expect([...a].some(([key, value]) => b.has(key) && Math.abs(b.get(key)! - value) > 1e-12)).toBe(true);
    });

    it("scores a perfect forecast as a QLIKE gain over trailing vol", () => {
        const perfect: AgentOutput = {
            ...output,
            predictions: output.predictions.filter((row) => row.realized != null).map((row) => ({...row, forecast: row.realized!})),
        };
        const score = scoreVolAgent(perfect);
        expect(score.extras[0].value).toBeCloseTo(0, 12);
        expect(score.value!).toBeGreaterThan(0);
    });
});

describe("orchestrator", () => {
    const input = syntheticInput({names: 8, sessions: SESSIONS, seed: 17});
    const asOfMonth = input.asOf.slice(0, 7);

    function badAgent(change: (output: AgentOutput) => AgentOutput): Agent {
        return {...technicalAgent, run: (data) => change(technicalAgent.run(data))};
    }

    it("rejects malformed output and still runs the other agents", () => {
        const nan = badAgent((output) => ({...output, predictions: output.predictions.map((row, i) => (i === 0 ? {...row, forecast: Number.NaN} : row))}));
        const stranger = badAgent((output) => ({...output, predictions: [...output.predictions, {...output.predictions[0], symbol: "ZZZZ"}]}));
        const peeking = badAgent((output) => ({
            ...output,
            predictions: output.predictions.map((row) => (row.month === asOfMonth ? {...row, realized: 0.01} : row)),
        }));
        const throwing: Agent = {...technicalAgent, run: () => {
            throw new Error("boom");
        }};
        const results = runAgentSet([nan, stranger, peeking, throwing, riskVolAgent], input);
        expect(results.map((result) => result.ok)).toEqual([false, false, false, false, true]);
        expect(results[3].ok === false && results[3].error).toBe("boom");
        const risk = results[4];
        expect(risk.ok && risk.live.length > 0 && risk.live.every((row) => row.month === asOfMonth)).toBe(true);
    });

    it("a second pass for the same asOf does nothing", () => {
        const now = new Date("2026-10-03T00:00:00.000Z");
        const hour = 60 * 60 * 1000;
        const agents = [technicalAgent, riskVolAgent];
        expect(agentsDue(agents, [], now, hour).map((agent) => agent.name)).toEqual(["technical", "risk"]);
        const done = [
            {agent: "technical", ok: true, startedAt: now, finishedAt: now},
            {agent: "risk", ok: true, startedAt: now, finishedAt: now},
        ];
        expect(agentsDue(agents, done, now, hour)).toEqual([]);
    });

    it("retries a failed agent and one whose run died, but not one still running", () => {
        const now = new Date("2026-10-03T12:00:00.000Z");
        const hour = 60 * 60 * 1000;
        const runs = [
            {agent: "technical", ok: false, startedAt: new Date(now.getTime() - 10 * 60_000), finishedAt: null},
            {agent: "risk", ok: false, startedAt: new Date(now.getTime() - 3 * hour), finishedAt: null},
        ];
        expect(agentsDue([technicalAgent, riskVolAgent], runs, now, hour).map((agent) => agent.name)).toEqual(["risk"]);
        const failed = [{agent: "technical", ok: false, startedAt: now, finishedAt: now}];
        expect(agentsDue([technicalAgent], failed, now, hour).map((agent) => agent.name)).toEqual(["technical"]);
    });
});
