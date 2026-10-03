import {garmanKlassDaily} from "../../services/risk.math";
import {ols} from "../ols";
import {expandingFolds} from "../walkForward";
import {isFresh, shiftMonth, symbolMonths} from "./monthly";
import type {Agent, AgentInput, AgentOutput, AgentPrediction, SymbolSeries} from "./types";

export const RISK_VERSION = "risk-har-v1";
export const HAR_MIN_TRAIN_MONTHS = 60;
export const HAR_REFIT_MONTHS = 12;
const TRADING_DAYS = 252;
const WEEK = 5;
const MONTH = 22;
/** A target month with fewer usable bars than this is not a measurement of that month's vol. */
const MIN_TARGET_SESSIONS = 10;

/** Fewer daily rows than this (about a year) and the four coefficients are noise. */
const MIN_FIT_ROWS = 250;

export type HarRegressors = [number, number, number];
/** A month-end forecast point. `feature` is the session the regressors are read at. */
export type HarSample = {month: string; feature: number; x: HarRegressors; y: number | null};
/** A daily estimation row: regressors at `end`, target over the next MONTH sessions, known at `targetEnd`. */
export type HarRow = {targetEnd: number; x: HarRegressors; y: number | null};

/** Mean of the finite values, or NaN when fewer than `min` are finite. */
function finiteMean(values: number[], min: number): number {
    const finite = values.filter(Number.isFinite);
    return finite.length < min ? Number.NaN : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

export function dailyVariances(series: SymbolSeries): number[] {
    return series.dates.map((_, i) => garmanKlassDaily(series.open[i], series.high[i], series.low[i], series.close[i]) ?? Number.NaN);
}

/** Corsi (2009) regressors at session `i`: that day's, the last week's and the last month's mean daily variance. */
function regressors(gk: number[], i: number): HarRegressors | null {
    if (i < MONTH - 1) return null;
    const x: HarRegressors = [gk[i], finiteMean(gk.slice(i - WEEK + 1, i + 1), 3), finiteMean(gk.slice(i - MONTH + 1, i + 1), 15)];
    return x.every(Number.isFinite) ? x : null;
}

/** Daily rows with overlapping targets, the way Corsi estimates HAR. */
export function harRows(series: SymbolSeries): HarRow[] {
    const gk = dailyVariances(series);
    const rows: HarRow[] = [];
    for (let i = MONTH - 1; i + MONTH < gk.length; i++) {
        const x = regressors(gk, i);
        if (!x) continue;
        const y = finiteMean(gk.slice(i + 1, i + MONTH + 1), MIN_TARGET_SESSIONS);
        rows.push({targetEnd: i + MONTH, x, y: Number.isFinite(y) ? y : null});
    }
    return rows;
}

/**
 * Month-end forecast points, regressors read the session before the close.
 * The outcome is the mean daily variance over the following month's sessions.
 */
export function harSamples(series: SymbolSeries): HarSample[] {
    const gk = dailyVariances(series);
    const months = symbolMonths(series);
    const samples: HarSample[] = [];
    for (const [month, end] of months) {
        const x = regressors(gk, end.feature);
        if (!x) continue;
        const next = months.get(shiftMonth(month, 1));
        const y = next ? finiteMean(gk.slice(end.index + 1, next.index + 1), MIN_TARGET_SESSIONS) : Number.NaN;
        samples.push({month, feature: end.feature, x, y: Number.isFinite(y) ? y : null});
    }
    return samples.sort((a, b) => a.month.localeCompare(b.month));
}

export type HarFit = {beta: number[]; floor: number};

export function fitHar(samples: {x: HarRegressors; y: number | null}[]): HarFit | null {
    const known = samples.filter((sample) => sample.y != null);
    if (known.length < MIN_FIT_ROWS) return null;
    try {
        const result = ols(known.map((sample) => sample.y!), known.map((sample) => [...sample.x]), 0);
        // Never forecast below the calmest stretch seen in training; a negative variance is not a forecast.
        return {beta: result.beta, floor: Math.min(...known.map((sample) => sample.y!))};
    } catch {
        return null;
    }
}

export function harForecast(fit: HarFit, x: HarRegressors): number {
    const value = fit.beta[0] + fit.beta[1] * x[0] + fit.beta[2] * x[1] + fit.beta[3] * x[2];
    return Math.max(value, fit.floor);
}

function toVol(variance: number): number {
    return Math.sqrt(TRADING_DAYS * variance);
}

export function runRiskVol(input: AgentInput): AgentOutput {
    const asOfMonth = input.asOf.slice(0, 7);
    const predictions: AgentPrediction[] = [];
    const short: string[] = [];
    for (const series of input.series) {
        const samples = harSamples(series);
        const rows = harRows(series);
        const lastDate = series.dates[series.dates.length - 1];
        const live = samples.find((sample) => sample.month === asOfMonth);
        // A name whose bars stop before the month end would be forecast from stale data.
        const usable = live && lastDate && !isFresh(lastDate, input.asOf) ? samples.filter((sample) => sample !== live) : samples;
        const folds = expandingFolds(usable.length, HAR_MIN_TRAIN_MONTHS, HAR_REFIT_MONTHS);
        if (folds.length === 0) short.push(series.symbol);
        for (const fold of folds) {
            const test = usable.slice(fold.testStart, fold.testEnd);
            // Only rows whose 22-session outcome was complete before the first test month's inputs were read.
            const fit = fitHar(rows.filter((row) => row.targetEnd <= test[0].feature));
            if (!fit) continue;
            for (const sample of test) {
                predictions.push({
                    month: sample.month,
                    symbol: series.symbol,
                    forecast: toVol(harForecast(fit, sample.x)),
                    baseline: toVol(sample.x[2]),
                    realized: sample.y == null ? null : toVol(sample.y),
                });
            }
        }
    }

    const notes = [
        `HAR (Corsi 2009) per name by OLS on daily rows: the mean Garman–Klass variance of the next ${MONTH} sessions on the last session's, the last week's and the last month's. At each month end the regressors are read the session before the close.`,
        `Expanding walk-forward per name: forecasts start after ${HAR_MIN_TRAIN_MONTHS} month ends, refit every ${HAR_REFIT_MONTHS}, and a fit only uses rows whose outcome was complete before the forecast. Forecasts are floored at the calmest ${MONTH}-session stretch in training.`,
        "Garman–Klass uses each day's open, high, low and close, so it misses the overnight gap and runs below close-to-close vol. Forecast and outcome use the same measure.",
        "Recorded ATM implied vol joins the inputs once 252 sessions exist; recording started on 2026-09-25.",
    ];
    if (short.length > 0) notes.push(`No forecast for ${short.join(", ")}: fewer than ${HAR_MIN_TRAIN_MONTHS + 1} usable months.`);
    return {agent: "risk", version: RISK_VERSION, target: "vol", horizon: "1m", predictions, notes};
}

export const riskVolAgent: Agent = {
    name: "risk",
    version: RISK_VERSION,
    target: "vol",
    horizon: "1m",
    run: runRiskVol,
};
