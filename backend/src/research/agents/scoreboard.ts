import {stationaryBootstrap, type Interval} from "../bootstrap";
import {costDrag} from "../costs";
import {topThirdCount, weightTurnover} from "../momentum";
import {mean} from "./monthly";
import {neweyWestMean, qlike, spearman} from "./scoring";
import type {AgentOutput, AgentPrediction} from "./types";

/** Monthly series: three months of autocorrelation for the SE, three-month blocks for the bootstrap. */
export const SCORE_NW_LAG = 3;
export const SCORE_BLOCK_MONTHS = 3;
export const MIN_SCORED_NAMES = 5;
/** Below this the t-stat is too unstable to put a verdict on. */
export const MIN_VERDICT_MONTHS = 12;

export type ScoreExtra = {label: string; value: number | null; format: "number" | "pct"};

export type AgentScore = {
    agent: AgentOutput["agent"];
    version: string;
    target: AgentOutput["target"];
    horizon: AgentOutput["horizon"];
    metric: string;
    months: number;
    avgNames: number | null;
    from: string | null;
    to: string | null;
    value: number | null;
    se: number | null;
    tStat: number | null;
    interval: Interval | null;
    baseline: {label: string; value: number | null; difference: number | null; tStat: number | null};
    extras: ScoreExtra[];
    verdict: string;
};

function scoredMonths(predictions: AgentPrediction[]): {month: string; rows: AgentPrediction[]}[] {
    const byMonth = new Map<string, AgentPrediction[]>();
    for (const row of predictions) {
        if (row.realized == null) continue;
        const rows = byMonth.get(row.month) ?? [];
        rows.push(row);
        byMonth.set(row.month, rows);
    }
    return [...byMonth.entries()]
        .filter(([, rows]) => rows.length >= MIN_SCORED_NAMES)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, rows]) => ({month, rows}));
}

function meanInterval(series: number[]): Interval | null {
    return stationaryBootstrap(series, {mean}, {blockLength: SCORE_BLOCK_MONTHS}).mean;
}

function fmt(value: number, digits: number): string {
    return value.toFixed(digits);
}

/** Long the top third, short the bottom third by forecast, equal weight, rebalanced monthly. */
export function spreadReturns(months: {month: string; rows: AgentPrediction[]}[]): {net: number[]; turnover: number[]} {
    let held: Record<string, number> = {};
    const net: number[] = [];
    const turnover: number[] = [];
    for (const {rows} of months) {
        const sorted = [...rows].sort((a, b) => b.forecast - a.forecast || a.symbol.localeCompare(b.symbol));
        const count = topThirdCount(sorted.length);
        const top = sorted.slice(0, count);
        const bottom = sorted.slice(-count);
        const weights: Record<string, number> = {};
        for (const row of top) weights[row.symbol] = 1 / count;
        for (const row of bottom) weights[row.symbol] = (weights[row.symbol] ?? 0) - 1 / count;
        const traded = weightTurnover(held, weights);
        const gross = mean(top.map((row) => row.realized!)) - mean(bottom.map((row) => row.realized!));
        net.push(gross - costDrag(traded));
        turnover.push(traded);
        held = weights;
    }
    return {net, turnover};
}

export function scoreReturnAgent(output: AgentOutput): AgentScore {
    const months = scoredMonths(output.predictions);
    const ic: number[] = [];
    const baseIc: number[] = [];
    const kept: typeof months = [];
    for (const month of months) {
        const realized = month.rows.map((row) => row.realized!);
        const a = spearman(month.rows.map((row) => row.forecast), realized);
        const b = spearman(month.rows.map((row) => row.baseline), realized);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        ic.push(a);
        baseIc.push(b);
        kept.push(month);
    }
    const stats = neweyWestMean(ic, SCORE_NW_LAG);
    const base = neweyWestMean(baseIc, SCORE_NW_LAG);
    const diff = neweyWestMean(ic.map((value, i) => value - baseIc[i]), SCORE_NW_LAG);
    const spread = spreadReturns(kept);
    const interval = meanInterval(ic);

    let verdict = `Only ${ic.length} scored months; too few to judge.`;
    if (stats && ic.length >= MIN_VERDICT_MONTHS) {
        const skill = stats.tStat >= 2 && (interval == null || interval.low > 0);
        const head = `Mean IC ${fmt(stats.mean, 3)} (t = ${fmt(stats.tStat, 2)}) over ${ic.length} months.`;
        const body = skill
            ? " Evidence of ranking skill."
            : stats.tStat <= -2
              ? " It ranks names the wrong way round."
              : " No evidence of ranking skill.";
        const versus = !diff
            ? ""
            : diff.tStat >= 2
              ? " Beats plain 12-1 momentum."
              : diff.tStat <= -2
                ? " Worse than plain 12-1 momentum."
                : " Not distinguishable from plain 12-1 momentum.";
        verdict = head + body + versus;
    }

    return {
        agent: output.agent,
        version: output.version,
        target: output.target,
        horizon: output.horizon,
        metric: "Mean monthly IC (Spearman)",
        months: ic.length,
        avgNames: kept.length === 0 ? null : mean(kept.map((month) => month.rows.length)),
        from: kept[0]?.month ?? null,
        to: kept[kept.length - 1]?.month ?? null,
        value: stats?.mean ?? null,
        se: stats?.se ?? null,
        tStat: stats?.tStat ?? null,
        interval,
        baseline: {label: "12-1 momentum IC", value: base?.mean ?? null, difference: diff?.mean ?? null, tStat: diff?.tStat ?? null},
        extras: [
            {label: "Hit rate (IC > 0)", value: ic.length === 0 ? null : ic.filter((value) => value > 0).length / ic.length, format: "pct"},
            {label: "Top − bottom third, after costs, annualized", value: spread.net.length === 0 ? null : mean(spread.net) * 12, format: "pct"},
            {label: "Avg monthly turnover", value: spread.turnover.length === 0 ? null : mean(spread.turnover), format: "number"},
        ],
        verdict,
    };
}

export function scoreVolAgent(output: AgentOutput): AgentScore {
    const months = scoredMonths(output.predictions);
    const gain: number[] = [];
    const model: number[] = [];
    const base: number[] = [];
    let mseModel = 0;
    let mseBase = 0;
    const kept: typeof months = [];
    for (const month of months) {
        const rows = month.rows.filter((row) => row.realized! > 0 && row.forecast > 0 && row.baseline > 0);
        if (rows.length < MIN_SCORED_NAMES) continue;
        const lossModel = rows.map((row) => qlike(row.realized! ** 2, row.forecast ** 2));
        const lossBase = rows.map((row) => qlike(row.realized! ** 2, row.baseline ** 2));
        for (const row of rows) {
            mseModel += (row.realized! ** 2 - row.forecast ** 2) ** 2;
            mseBase += (row.realized! ** 2 - row.baseline ** 2) ** 2;
        }
        model.push(mean(lossModel));
        base.push(mean(lossBase));
        gain.push(mean(lossBase) - mean(lossModel));
        kept.push({month: month.month, rows});
    }
    const stats = neweyWestMean(gain, SCORE_NW_LAG);
    const interval = meanInterval(gain);

    let verdict = `Only ${gain.length} scored months; too few to judge.`;
    if (stats && gain.length >= MIN_VERDICT_MONTHS) {
        const head = `QLIKE ${fmt(mean(model), 3)} against ${fmt(mean(base), 3)} for trailing vol over ${gain.length} months (Diebold–Mariano t = ${fmt(stats.tStat, 2)}).`;
        const body = stats.tStat >= 2
            ? " HAR forecasts next month's vol better than last month's vol does."
            : stats.tStat <= -2
              ? " HAR is worse than simply carrying last month's vol forward."
              : " Not distinguishable from carrying last month's vol forward.";
        verdict = head + body;
    }

    return {
        agent: output.agent,
        version: output.version,
        target: output.target,
        horizon: output.horizon,
        metric: "QLIKE gain over trailing vol",
        months: gain.length,
        avgNames: kept.length === 0 ? null : mean(kept.map((month) => month.rows.length)),
        from: kept[0]?.month ?? null,
        to: kept[kept.length - 1]?.month ?? null,
        value: stats?.mean ?? null,
        se: stats?.se ?? null,
        tStat: stats?.tStat ?? null,
        interval,
        baseline: {label: "Trailing 22-session vol QLIKE", value: base.length === 0 ? null : mean(base), difference: stats?.mean ?? null, tStat: stats?.tStat ?? null},
        extras: [
            {label: "HAR QLIKE", value: model.length === 0 ? null : mean(model), format: "number"},
            {label: "MSE vs trailing (ratio)", value: mseBase > 0 ? mseModel / mseBase : null, format: "number"},
        ],
        verdict,
    };
}

export function scoreAgent(output: AgentOutput): AgentScore {
    return output.target === "vol" ? scoreVolAgent(output) : scoreReturnAgent(output);
}
