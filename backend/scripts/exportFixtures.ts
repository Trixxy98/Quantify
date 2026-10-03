/**
 * Golden fixtures for the Python port. Runs the TS pure functions on fixed,
 * seeded inputs and writes {fn, args, result} cases per module to
 * backend-py/tests/fixtures/<module>.json. The Python tests call their port of
 * `fn` with the same args and compare.
 *
 * Usage: npx tsx scripts/exportFixtures.ts
 */
import {mkdirSync, writeFileSync} from "node:fs";
import path from "node:path";
import {seededRandom} from "../src/research/bootstrap";
import * as stats from "../src/utils/stats.util";
import * as metrics from "../src/services/metrics.service";
import * as fx from "../src/services/fx";
import * as corporate from "../src/services/corporateActions";
import * as lots from "../src/services/lots.service";
import * as risk from "../src/services/risk.math";
import * as bootstrap from "../src/research/bootstrap";
import * as ols from "../src/research/ols";
import * as french from "../src/research/french";
import * as bs from "../src/services/blackScholes";
import * as iv from "../src/services/impliedSnapshot.service";
import * as vp from "../src/services/variancePremium.service";
import * as es from "../src/services/eventStudy.service";
import {syntheticInput} from "../src/research/agents/__tests__/synthetic";
import {runTechnical} from "../src/research/agents/technical";
import {runRiskVol} from "../src/research/agents/riskVol";
import {scoreAgent} from "../src/research/agents/scoreboard";
import {spearman} from "../src/research/agents/scoring";
import {completedMonthEnd} from "../src/research/agents/orchestrator";
import {ridge} from "../src/research/ridge";

const OUT = path.resolve(__dirname, "../../backend-py/tests/fixtures");
type Case = {fn: string; args: unknown[]; result: unknown};
const modules = new Map<string, Case[]>();

/** JSON has no NaN/Infinity; keep them distinguishable from null. */
function encode(value: unknown): unknown {
    if (typeof value === "number") {
        if (Number.isNaN(value)) return {$num: "NaN"};
        if (value === Infinity) return {$num: "Infinity"};
        if (value === -Infinity) return {$num: "-Infinity"};
        return value;
    }
    if (value instanceof Date) return {$date: value.toISOString()};
    if (value instanceof Map) return {$map: [...value.entries()].map(([k, v]) => [encode(k), encode(v)])};
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encode(v)]));
    }
    return value;
}

export function record(module: string, fn: string, args: unknown[], result: unknown) {
    const list = modules.get(module) ?? [];
    list.push({fn, args: encode(args) as unknown[], result: encode(result)});
    modules.set(module, list);
}

export function series(seed: number, n: number, scale = 0.01, drift = 0.0003): number[] {
    const random = seededRandom(seed);
    return Array.from({length: n}, () => drift + scale * (random() + random() + random() - 1.5) * 1.4);
}

export function values(seed: number, n: number, start = 100): {date: string; value: number}[] {
    const rets = series(seed, n);
    let value = start;
    const day = Date.UTC(2024, 0, 1);
    return rets.map((r, i) => {
        value *= 1 + r;
        return {date: new Date(day + i * 86_400_000).toISOString().slice(0, 10), value};
    });
}

function ledger() {
    const m = "ledger";
    const a = series(1, 300);
    const b = series(2, 300, 0.012);
    const flat = Array.from({length: 50}, () => 0.001);
    record(m, "stats.average", [a], stats.average(a));
    record(m, "stats.variance", [a], stats.variance(a));
    record(m, "stats.stdDev", [b], stats.stdDev(b));
    record(m, "stats.covariance", [a, b], stats.covariance(a, b));

    const v = values(3, 260);
    record(m, "metrics.toDailyReturns", [v], metrics.toDailyReturns(v));
    record(m, "metrics.todayReturn", [v], metrics.todayReturn(v));
    for (const rets of [a, b, flat, []]) {
        record(m, "metrics.annualizedReturn", [rets], metrics.annualizedReturn(rets));
        record(m, "metrics.volatility", [rets], metrics.volatility(rets));
        record(m, "metrics.sharpeRatio", [rets, 0.03], metrics.sharpeRatio(rets, 0.03));
        record(m, "metrics.sharpeStandardError", [rets, 0.03], metrics.sharpeStandardError(rets, 0.03));
        record(m, "metrics.maxDrawdownFromReturns", [rets], metrics.maxDrawdownFromReturns(rets));
        record(m, "metrics.cagrFromReturns", [rets, 1.2], metrics.cagrFromReturns(rets, 1.2));
    }
    record(m, "metrics.annualizedReturn", [[-0.6, -0.6, -0.6]], metrics.annualizedReturn([-0.6, -0.6, -0.6]));
    record(m, "metrics.cagr", [100, 140, 2], metrics.cagr(100, 140, 2));
    record(m, "metrics.cagr", [0, 140, 2], metrics.cagr(0, 140, 2));
    record(m, "metrics.beta", [a, b], metrics.beta(a, b));
    record(m, "metrics.beta", [a, flat], metrics.beta(a, flat));
    record(m, "metrics.alpha", [0.12, 0.08, 0.03, 1.1], metrics.alpha(0.12, 0.08, 0.03, 1.1));
    record(m, "metrics.maxDrawdown", [v], metrics.maxDrawdown(v));
    record(m, "metrics.compositeBenchmarkReturns", [a, b, 0.4, 0.6], metrics.compositeBenchmarkReturns(a, b, 0.4, 0.6));
    record(m, "metrics.indexTo100", [v.slice(0, 30)], metrics.indexTo100(v.slice(0, 30)));
    const flows = new Map([[v[10].date, 500], [v[40].date, -300]]);
    const income = new Map([[v[20].date, 12.5]]);
    record(m, "metrics.timeWeightedIndex", [v.slice(0, 60), flows, income], metrics.timeWeightedIndex(v.slice(0, 60), flows, income));

    for (const stamp of ["2026-07-01T23:00:00.000Z", "2026-12-01T00:00:00.000Z", "2026-03-29T00:30:00.000Z", "2026-10-25T00:30:00.000Z"]) {
        record(m, "fx.fxBarDate", [new Date(stamp)], fx.fxBarDate(new Date(stamp)));
    }
    record(m, "fx.isWeekendDate", [new Date("2026-10-03T00:00:00.000Z")], fx.isWeekendDate(new Date("2026-10-03T00:00:00.000Z")));
    record(m, "fx.isWeekendDate", [new Date("2026-10-05T00:00:00.000Z")], fx.isWeekendDate(new Date("2026-10-05T00:00:00.000Z")));
    const fxSeries = [{date: Date.UTC(2026, 0, 2), close: 4.4}, {date: Date.UTC(2026, 0, 5), close: 4.45}, {date: Date.UTC(2026, 0, 6), close: 4.42}];
    for (const time of [Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 4), Date.UTC(2026, 0, 6), Date.UTC(2026, 1, 1)]) {
        record(m, "fx.latestAtOrBefore", [fxSeries, time], fx.latestAtOrBefore(fxSeries, time));
        record(m, "fx.toBase", [100, "USD", "MYR", fxSeries, time], fx.toBase(100, "USD", "MYR", fxSeries, time));
        record(m, "fx.toBase", [100, "MYR", "USD", fxSeries, time], fx.toBase(100, "MYR", "USD", fxSeries, time));
    }

    record(m, "corporate.isRebased", [100, 100.4], corporate.isRebased(100, 100.4));
    record(m, "corporate.isRebased", [100, 25], corporate.isRebased(100, 25));
    record(m, "corporate.isRebased", [0, 25], corporate.isRebased(0, 25));
    const splits = [
        {date: new Date("2024-06-10T00:00:00.000Z"), numerator: 10, denominator: 1},
        {date: new Date("2025-03-01T00:00:00.000Z"), numerator: 2, denominator: 1},
        {date: new Date("2025-06-01T00:00:00.000Z"), numerator: 0, denominator: 1},
    ];
    for (const when of ["2024-01-01T00:00:00.000Z", "2024-06-10T00:00:00.000Z", "2025-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"]) {
        const time = new Date(when).getTime();
        record(m, "corporate.splitFactorAfter", [splits, time], corporate.splitFactorAfter(splits, time));
        record(m, "corporate.adjustTrade", [10, 500, splits, time], corporate.adjustTrade(10, 500, splits, time));
    }

    const trades: lots.LotTrade[] = [
        {id: "t1", symbol: "AAPL", type: "BUY", quantity: 10, price: 150, fee: 1, date: new Date("2024-01-02T00:00:00.000Z"), createdAt: new Date("2024-01-02T01:00:00.000Z"), currency: "USD"},
        {id: "t2", symbol: "AAPL", type: "BUY", quantity: 5, price: 170, fee: 1, date: new Date("2024-03-02T00:00:00.000Z"), createdAt: new Date("2024-03-02T01:00:00.000Z"), currency: "USD"},
        {id: "t3", symbol: "AAPL", type: "SELL", quantity: 8, price: 190, fee: 1, date: new Date("2024-05-02T00:00:00.000Z"), createdAt: new Date("2024-05-02T01:00:00.000Z"), currency: "USD"},
        {id: "t4", symbol: "1155.KL", type: "BUY", quantity: 1000, price: 9.5, fee: 10, date: new Date("2024-02-01T00:00:00.000Z"), createdAt: new Date("2024-02-01T01:00:00.000Z"), currency: "MYR"},
        {id: "t5", symbol: "AAPL", type: "SELL", quantity: 7, price: 200, fee: 1, date: new Date("2024-07-02T00:00:00.000Z"), createdAt: new Date("2024-07-02T01:00:00.000Z"), currency: "USD"},
        {id: "t6", symbol: "1155.KL", type: "SELL", quantity: 1000, price: 10.2, fee: 10, date: new Date("2024-08-01T00:00:00.000Z"), createdAt: new Date("2024-08-01T01:00:00.000Z"), currency: "MYR"},
        {id: "t7", symbol: "NVDA", type: "BUY", quantity: 2, price: 1000, fee: 0, date: new Date("2024-05-01T00:00:00.000Z"), createdAt: new Date("2024-05-01T01:00:00.000Z"), currency: "USD"},
        {id: "t8", symbol: "NVDA", type: "SELL", quantity: 20, price: 120, fee: 0, date: new Date("2024-07-01T00:00:00.000Z"), createdAt: new Date("2024-07-01T01:00:00.000Z"), currency: "USD"},
        {id: "t9", symbol: "AAPL", type: "SELL", quantity: 3, price: 210, fee: 0, date: new Date("2024-09-01T00:00:00.000Z"), createdAt: new Date("2024-09-01T01:00:00.000Z"), currency: "USD"},
    ];
    const lotSplits = new Map([["NVDA", [{date: new Date("2024-06-10T00:00:00.000Z"), numerator: 10, denominator: 1}]]]);
    const usdMyr = [{date: Date.UTC(2024, 0, 1), close: 4.6}, {date: Date.UTC(2024, 5, 1), close: 4.7}];
    const toBaseFn: lots.ToBaseFn = (value, from, time) => fx.toBase(value, from, "MYR", usdMyr, time);
    const replay = lots.replayRealized(trades, lotSplits, toBaseFn);
    record(m, "lots.replayRealized", [trades, lotSplits, usdMyr, "MYR"], {sells: [...replay.sells.values()], lots: replay.lots});
}

function riskAndBootstrap() {
    const m = "risk";
    const a = series(11, 400);
    const b = series(12, 400, 0.014);
    const c = series(13, 400, 0.008);
    const dates = a.map((_, i) => new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
    record(m, "risk.garmanKlassDaily", [100, 103, 98, 101], risk.garmanKlassDaily(100, 103, 98, 101));
    record(m, "risk.garmanKlassDaily", [100, 98, 103, 101], risk.garmanKlassDaily(100, 98, 103, 101));
    record(m, "risk.garmanKlassDaily", [100, 100, 100, 100], risk.garmanKlassDaily(100, 100, 100, 100));
    record(m, "risk.annualizedVolFromDailyVariances", [a.map((x) => x * x)], risk.annualizedVolFromDailyVariances(a.map((x) => x * x)));
    for (const p of [0.01, 0.05, 0.5]) {
        record(m, "risk.quantile", [a, p], risk.quantile(a, p));
        record(m, "risk.expectedShortfall", [a, p], risk.expectedShortfall(a, p));
    }
    record(m, "risk.kupiecStatistic", [17, 340, 0.05], risk.kupiecStatistic(17, 340, 0.05));
    record(m, "risk.kupiecStatistic", [0, 100, 0.05], risk.kupiecStatistic(0, 100, 0.05));
    record(m, "risk.kupiecStatistic", [30, 100, 0.05], risk.kupiecStatistic(30, 100, 0.05));
    const cov = risk.sampleCovarianceMatrix([a, b, c]);
    record(m, "risk.sampleCovarianceMatrix", [[a, b, c]], cov);
    record(m, "risk.correlationMatrix", [cov], risk.correlationMatrix(cov));
    record(m, "risk.portfolioRisk", [[0.5, 0.3, 0.2], cov], risk.portfolioRisk([0.5, 0.3, 0.2], cov));
    const v = values(14, 300);
    record(m, "risk.ulcerIndex", [v.map((p) => p.value)], risk.ulcerIndex(v.map((p) => p.value)));
    record(m, "risk.drawdownEpisodes", [v, 5], risk.drawdownEpisodes(v, 5));
    record(m, "risk.rollingVolBeta", [a.slice(0, 120), b.slice(0, 120), dates.slice(0, 120), 60], risk.rollingVolBeta(a.slice(0, 120), b.slice(0, 120), dates.slice(0, 120), 60));

    const random = bootstrap.seededRandom(7);
    record(m, "bootstrap.seededRandom", [7, 50], Array.from({length: 50}, () => random()));
    record(m, "bootstrap.stationaryBootstrapIndices", [100, 20, 3], bootstrap.stationaryBootstrapIndices(100, 20, bootstrap.seededRandom(3)));
    record(m, "bootstrap.stationaryBootstrap.sharpe", [a], bootstrap.stationaryBootstrap(a, {sharpe: (s) => metrics.sharpeRatio(s, 0.03), dd: metrics.maxDrawdownFromReturns}));
    record(m, "bootstrap.stationaryBootstrap.sharpe", [a.slice(0, 40)], bootstrap.stationaryBootstrap(a.slice(0, 40), {sharpe: (s) => metrics.sharpeRatio(s, 0.03), dd: metrics.maxDrawdownFromReturns}));
    const clusters = Array.from({length: 12}, (_, i) => series(30 + i, 5));
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    record(m, "bootstrap.clusterBootstrap.mean", [clusters], bootstrap.clusterBootstrap(clusters, mean));
    record(m, "bootstrap.clusterBootstrap.mean", [clusters.slice(0, 5)], bootstrap.clusterBootstrap(clusters.slice(0, 5), mean));
    record(m, "bootstrap.quantile", [[1, 2, 3, 4, 5], 0.05], bootstrap.quantile([1, 2, 3, 4, 5], 0.05));
}

function factorModels() {
    const m = "factors";
    const n = 300;
    const xs = [series(41, n), series(42, n, 0.006), series(43, n, 0.004)];
    const noise = series(44, n, 0.003, 0);
    const y = xs[0].map((_, t) => 0.0002 + 1.1 * xs[0][t] - 0.4 * xs[1][t] + 0.2 * xs[2][t] + noise[t]);
    const x = y.map((_, t) => xs.map((col) => col[t]));
    for (const lag of [0, 1, 5]) record(m, "ols.ols", [y, x, lag], ols.ols(y, x, lag));
    record(m, "ols.ols", [y.slice(0, 30), x.slice(0, 30).map((row) => [row[0]]), 5], ols.ols(y.slice(0, 30), x.slice(0, 30).map((row) => [row[0]]), 5));
    record(m, "ols.ols", [y, y.map(() => []), 3], ols.ols(y, y.map(() => []), 3));
    const csv = [
        "This file was created by CMPT_ME_BEME_RETS_DAILY using the 202608 CRSP database.",
        "",
        ",Mkt-RF,SMB,HML,RMW,CMA,RF",
        "20260803,  0.52, -0.11,  0.07, 0.02, -0.03, 0.017",
        "20260804, -1.25,  0.40, -0.21, 0.10,  0.05, 0.017",
        "20260805,  0.00,  -99.99,  0.10, , 0.01, 0.017",
        "",
        " Annual Factors: January-December",
        ",Mkt-RF,SMB,HML,RMW,CMA,RF",
        "2025, 12.0, 1.0, 2.0, 3.0, 4.0, 5.0",
    ].join("\r\n");
    record(m, "french.parseFrenchDaily", [csv], french.parseFrenchDaily(csv));
}

function optionsAndEvents() {
    const m = "options";
    for (const x of [-3, -1.2, 0, 0.4, 2.5]) {
        record(m, "bs.normCdf", [x], bs.normCdf(x));
        record(m, "bs.normPdf", [x], bs.normPdf(x));
    }
    const grid: [number, number, number, number][] = [
        [100, 90, 0.1, 0.25], [100, 100, 0.5, 0.2], [100, 120, 1, 0.35], [50, 45, 0.02, 0.6], [200, 150, 2, 0.15],
    ];
    for (const [spot, strike, time, vol] of grid) {
        for (const right of ["call", "put"] as const) {
            const price = bs.blackScholesPrice(spot, strike, time, 0.03, 0.01, vol, right);
            record(m, "bs.blackScholesPrice", [spot, strike, time, 0.03, 0.01, vol, right], price);
            record(m, "bs.impliedVol", [price, spot, strike, time, 0.03, 0.01, right], bs.impliedVol(price, spot, strike, time, 0.03, 0.01, right));
        }
        record(m, "bs.blackScholesVega", [spot, strike, time, 0.03, 0.01, vol], bs.blackScholesVega(spot, strike, time, 0.03, 0.01, vol));
    }
    record(m, "bs.impliedVol", [0.0001, 100, 60, 0.05, 0.03, 0, "call"], bs.impliedVol(0.0001, 100, 60, 0.05, 0.03, 0, "call"));
    record(m, "bs.impliedVol", [45, 100, 60, 1, 0.03, 0, "call"], bs.impliedVol(45, 100, 60, 1, 0.03, 0, "call"));
    record(m, "bs.blackScholesPrice", [100, 90, 0, 0.03, 0, 0.2, "call"], bs.blackScholesPrice(100, 90, 0, 0.03, 0, 0.2, "call"));

    const calls = [{strike: 95, bid: 6, ask: 6.4, impliedVolatility: 0.22}, {strike: 100, bid: 0, ask: 0, lastPrice: 3.1, impliedVolatility: 0.2}, {strike: 105, bid: 1, ask: 1.2}];
    const puts = [{strike: 95, bid: 1, ask: 1.1}, {strike: 100, bid: 2.9, ask: 3.1, impliedVolatility: 0.21}, {strike: 105, bid: 5.5, ask: 6}];
    record(m, "iv.atmStraddle", [calls, puts, 101], iv.atmStraddle(calls, puts, 101));
    record(m, "iv.atmStraddle", [calls, puts, 0], iv.atmStraddle(calls, puts, 0));
    const expiries = ["2026-10-09", "2026-10-16", "2026-10-30", "2026-11-20"].map((d) => new Date(`${d}T00:00:00.000Z`));
    record(m, "iv.frontMonthExpiry", [expiries, new Date("2026-10-03T12:00:00.000Z")], iv.frontMonthExpiry(expiries, new Date("2026-10-03T12:00:00.000Z")));
    record(m, "iv.ivRank", [[{iv: 0.2}, {iv: 0.3}, {iv: 0.25}], 0.25], iv.ivRank([{iv: 0.2}, {iv: 0.3}, {iv: 0.25}], 0.25));

    record(m, "vp.median", [[3, 1, 2, 8]], vp.median([3, 1, 2, 8]));
    record(m, "vp.percentileRank", [[0.01, 0.03, 0.02], 0.02], vp.percentileRank([0.01, 0.03, 0.02], 0.02));
    const keys = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"];
    const closes = [100, 102, 99, 101];
    for (const [day, sessions] of [["2026-01-04", 1], ["2026-01-04", 2], ["2026-01-01", 1], ["2026-01-07", 2]] as const) {
        record(m, "vp.eventSessionMove", [keys, closes, day, sessions], vp.eventSessionMove(keys, closes, day, sessions));
    }
    const listed = ["2026-10-16", "2026-10-09", "2026-11-20"];
    record(m, "vp.expiryCovering", [listed, "2026-10-12"], vp.expiryCovering(listed, "2026-10-12"));
    record(m, "vp.expiryBefore", [listed, "2026-10-12"], vp.expiryBefore(listed, "2026-10-12"));
    record(m, "vp.eventVariance", [0.2, 0.05, 0.25, 0.1], vp.eventVariance(0.2, 0.05, 0.25, 0.1));
    record(m, "vp.eventVariance", [0.3, 0.05, 0.2, 0.1], vp.eventVariance(0.3, 0.05, 0.2, 0.1));
    record(m, "vp.impliedFromStraddle", [{impliedMove: 0.04, atmIv: null}, 0.1], vp.impliedFromStraddle({impliedMove: 0.04, atmIv: null}, 0.1));

    const events = Array.from({length: 30}, (_, i) => ({date: `2025-${String((i % 10) + 1).padStart(2, "0")}-15`, car: series(60 + i, 1, 0.02)[0]}));
    record(m, "es.finalCarInterval", [events, 10], es.finalCarInterval(events, 10));
}

function agents() {
    const m = "agents";
    const toJson = (input: ReturnType<typeof syntheticInput>) => ({asOf: input.asOf, series: input.series});
    const trending = syntheticInput({names: 12, sessions: 2100, seed: 4, persistentDrift: true});
    const noisy = syntheticInput({names: 8, sessions: 2100, seed: 13});
    const technical = runTechnical(trending);
    const risk = runRiskVol(noisy);
    record(m, "agents.runTechnical", [toJson(trending)], technical);
    record(m, "agents.runRiskVol", [toJson(noisy)], risk);
    record(m, "agents.scoreAgent", [technical], scoreAgent(technical));
    record(m, "agents.scoreAgent", [risk], scoreAgent(risk));
    record(m, "agents.spearman", [[1, 2, 2, 5, 3], [0.1, 0.4, 0.3, 0.9, 0.2]], spearman([1, 2, 2, 5, 3], [0.1, 0.4, 0.3, 0.9, 0.2]));
    record(m, "agents.ridge", [[[1, 0.2], [0.3, -1], [0.5, 0.5], [-0.7, 0.1]], [0.4, -0.2, 0.3, -0.1], 0.1], ridge([[1, 0.2], [0.3, -1], [0.5, 0.5], [-0.7, 0.1]], [0.4, -0.2, 0.3, -0.1], 0.1));
    for (const [calendar, session] of [
        [["2026-09-29", "2026-09-30"], "2026-10-02"],
        [["2026-08-31", "2026-09-29", "2026-09-30"], "2026-09-29"],
        [["2026-08-28", "2026-08-31", "2026-09-25"], "2026-10-02"],
        [["2026-09-25"], "2026-10-02"],
    ] as [string[], string][]) {
        record(m, "agents.completedMonthEnd", [calendar, session], completedMonthEnd(calendar, session));
    }
}

ledger();
riskAndBootstrap();
factorModels();
optionsAndEvents();
agents();

mkdirSync(OUT, {recursive: true});
for (const [module, cases] of modules) {
    writeFileSync(path.join(OUT, `${module}.json`), JSON.stringify(cases, null, 1));
    console.log(`${module}: ${cases.length} cases`);
}
