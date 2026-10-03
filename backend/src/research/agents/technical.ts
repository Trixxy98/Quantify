import {ridge, predict} from "../ridge";
import {expandingFolds} from "../walkForward";
import {freshMonth, latestMonthEnds, mean, monthDistance, shiftMonth, symbolMonths, type SymbolMonth} from "./monthly";
import {rankScore, spearman} from "./scoring";
import type {Agent, AgentInput, AgentOutput, AgentPrediction, SymbolSeries} from "./types";

export const TECHNICAL_VERSION = "technical-ridge-v1";
/** Fixed before the first run. Penalty on standardised features against a [-0.5, 0.5] rank target. */
export const TECHNICAL_LAMBDAS = [0.01, 0.1, 1, 10];
export const MIN_TRAIN_MONTHS = 60;
export const REFIT_MONTHS = 12;
/** The penalty is picked on the last two years of each training window, one fit per year. */
const INNER_BLOCK_MONTHS = 12;
const INNER_BLOCKS = 2;
export const MIN_CROSS_SECTION = 5;
const WINSOR_Z = 3;
const MA_SESSIONS = 200;
export const TECHNICAL_FEATURES = ["1m return", "3m return", "6m return", "12-1 momentum", "distance from 200-day mean"];
const MOMENTUM_FEATURE = 3;

type Row = {symbol: string; raw: number[]; z: number[]; realized: number | null};
type MonthPanel = {month: string; rows: Row[]};

/** Inputs for one name at one month end, all read at the session before the month-end close. */
export function technicalFeatures(series: SymbolSeries, months: Map<string, SymbolMonth>, month: string): number[] | null {
    const now = months.get(month);
    if (!now || now.feature < MA_SESSIONS - 1) return null;
    const back = (by: number) => months.get(shiftMonth(month, -by))?.feature;
    const i1 = back(1);
    const i3 = back(3);
    const i6 = back(6);
    const i12 = back(12);
    if (i1 == null || i3 == null || i6 == null || i12 == null) return null;

    const level = series.level;
    const at = level[now.feature];
    const window = level.slice(now.feature - MA_SESSIONS + 1, now.feature + 1);
    const values = [
        at / level[i1] - 1,
        at / level[i3] - 1,
        at / level[i6] - 1,
        level[i1] / level[i12] - 1,
        at / mean(window) - 1,
    ];
    return values.every(Number.isFinite) ? values : null;
}

function standardise(rows: {raw: number[]}[]): number[][] {
    const k = rows[0].raw.length;
    const z = rows.map(() => new Array<number>(k).fill(0));
    for (let j = 0; j < k; j++) {
        const column = rows.map((row) => row.raw[j]);
        const mu = mean(column);
        const sd = Math.sqrt(mean(column.map((value) => (value - mu) ** 2)));
        if (!(sd > 0)) continue;
        for (let i = 0; i < rows.length; i++) {
            z[i][j] = Math.max(-WINSOR_Z, Math.min(WINSOR_Z, (column[i] - mu) / sd));
        }
    }
    return z;
}

function buildPanel(input: AgentInput): MonthPanel[] {
    const us = input.series.filter((series) => series.market === "US");
    const months = us.map(symbolMonths);
    const latest = latestMonthEnds(months);
    const asOfMonth = input.asOf.slice(0, 7);
    const current = latest.get(asOfMonth);
    if (!current || current < input.asOf) latest.set(asOfMonth, input.asOf);

    const panels: MonthPanel[] = [];
    for (const month of [...latest.keys()].sort()) {
        const raw: {symbol: string; raw: number[]; realized: number | null}[] = [];
        us.forEach((series, s) => {
            const now = freshMonth(months[s], month, latest);
            if (!now) return;
            const features = technicalFeatures(series, months[s], month);
            if (!features) return;
            const next = freshMonth(months[s], shiftMonth(month, 1), latest);
            const realized = next ? series.level[next.index] / series.level[now.index] - 1 : null;
            raw.push({symbol: series.symbol, raw: features, realized: realized != null && Number.isFinite(realized) ? realized : null});
        });
        if (raw.length < MIN_CROSS_SECTION) continue;
        const z = standardise(raw);
        panels.push({month, rows: raw.map((row, i) => ({...row, z: z[i]}))});
    }
    return panels;
}

/** Stacked rows with the month's realized returns as [-0.5, 0.5] rank scores. */
function fit(panels: MonthPanel[], lambda: number): number[] | null {
    const x: number[][] = [];
    const y: number[] = [];
    for (const panel of panels) {
        const known = panel.rows.filter((row) => row.realized != null);
        if (known.length < MIN_CROSS_SECTION) continue;
        const scores = rankScore(known.map((row) => row.realized!));
        known.forEach((row, i) => {
            x.push(row.z);
            y.push(scores[i]);
        });
    }
    if (y.length === 0) return null;
    try {
        return ridge(x, y, lambda);
    } catch {
        return null;
    }
}

/** Months whose outcome was known before the first test month's inputs were read. */
function trainable(panels: MonthPanel[], firstTest: string): MonthPanel[] {
    return panels.filter((panel) => monthDistance(panel.month, firstTest) >= 2);
}

function monthIc(beta: number[], panel: MonthPanel): number {
    const known = panel.rows.filter((row) => row.realized != null);
    if (known.length < MIN_CROSS_SECTION) return Number.NaN;
    return spearman(known.map((row) => predict(beta, row.z)), known.map((row) => row.realized!));
}

/** Inner walk-forward on the training window only; ties go to the stronger penalty. */
export function chooseLambda(train: MonthPanel[]): number {
    const fallback = TECHNICAL_LAMBDAS[Math.floor(TECHNICAL_LAMBDAS.length / 2)];
    const validation = INNER_BLOCK_MONTHS * INNER_BLOCKS;
    if (train.length < validation + MIN_TRAIN_MONTHS / 2) return fallback;
    let best = fallback;
    let bestIc = Number.NEGATIVE_INFINITY;
    for (const lambda of TECHNICAL_LAMBDAS) {
        const ics: number[] = [];
        for (let block = 0; block < INNER_BLOCKS; block++) {
            const start = train.length - validation + block * INNER_BLOCK_MONTHS;
            const test = train.slice(start, start + INNER_BLOCK_MONTHS);
            const beta = fit(trainable(train.slice(0, start), test[0].month), lambda);
            if (!beta) continue;
            for (const panel of test) {
                const ic = monthIc(beta, panel);
                if (Number.isFinite(ic)) ics.push(ic);
            }
        }
        const score = ics.length === 0 ? Number.NEGATIVE_INFINITY : mean(ics);
        if (score >= bestIc) {
            bestIc = score;
            best = lambda;
        }
    }
    return best;
}

export function runTechnical(input: AgentInput): AgentOutput {
    const panels = buildPanel(input);
    const predictions: AgentPrediction[] = [];
    const lambdas: number[] = [];
    for (const fold of expandingFolds(panels.length, MIN_TRAIN_MONTHS, REFIT_MONTHS)) {
        const test = panels.slice(fold.testStart, fold.testEnd);
        const train = trainable(panels.slice(0, fold.trainEnd), test[0].month);
        const lambda = chooseLambda(train);
        const beta = fit(train, lambda);
        if (!beta) continue;
        lambdas.push(lambda);
        for (const panel of test) {
            for (const row of panel.rows) {
                predictions.push({
                    month: panel.month,
                    symbol: row.symbol,
                    forecast: predict(beta, row.z),
                    baseline: row.raw[MOMENTUM_FEATURE],
                    realized: row.realized,
                });
            }
        }
    }

    const notes = [
        `Cross-sectional ridge on ${TECHNICAL_FEATURES.join(", ")}, each standardised across names every month and capped at ±${WINSOR_Z}. The target is next month's total-return rank.`,
        `Expanding walk-forward: at least ${MIN_TRAIN_MONTHS} months of training, refit every ${REFIT_MONTHS}. The penalty is chosen from ${TECHNICAL_LAMBDAS.join(", ")} on the last ${INNER_BLOCK_MONTHS * INNER_BLOCKS} training months only.`,
        "Inputs are read one session before the month-end close, and a training month is only used once its outcome was known before the forecast.",
    ];
    if (lambdas.length > 0) notes.push(`Penalties chosen per refit: ${lambdas.join(", ")}.`);
    else notes.push(`Need ${MIN_TRAIN_MONTHS + 1} months with at least ${MIN_CROSS_SECTION} names before the first forecast.`);
    return {agent: "technical", version: TECHNICAL_VERSION, target: "returnScore", horizon: "1m", predictions, notes};
}

export const technicalAgent: Agent = {
    name: "technical",
    version: TECHNICAL_VERSION,
    target: "returnScore",
    horizon: "1m",
    run: runTechnical,
};
