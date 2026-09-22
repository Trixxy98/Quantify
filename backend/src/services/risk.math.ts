import {covariance, stdDev, variance} from "../utils/stats.util";

const TRADING_DAYS = 252;

/** Garman–Klass daily variance. Null when a print is missing or the bar is invalid. */
export function garmanKlassDaily(open: number, high: number, low: number, close: number): number | null {
    if (!(open > 0 && high > 0 && low > 0 && close > 0) || high < low) return null;
    const logHl = Math.log(high / low);
    const logCo = Math.log(close / open);
    const value = 0.5 * logHl * logHl - (2 * Math.LN2 - 1) * logCo * logCo;
    return value > 0 ? value : 0;
}

export function annualizedVolFromDailyVariances(dailyVariances: number[]): number {
    if (dailyVariances.length === 0) return 0;
    const mean = dailyVariances.reduce((sum, value) => sum + value, 0) / dailyVariances.length;
    return Math.sqrt(Math.max(mean, 0) * TRADING_DAYS);
}

/** Nearest-rank quantile. p = 0.05 is the historical 95% VaR threshold. */
export function quantile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[index];
}

export function expectedShortfall(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const cutoff = quantile(values, p);
    const tail = values.filter((value) => value <= cutoff);
    if (tail.length === 0) return cutoff;
    return tail.reduce((sum, value) => sum + value, 0) / tail.length;
}

/**
 * Kupiec proportion-of-failures statistic. Rejects at 5% when the likelihood
 * ratio exceeds the chi-square(1) critical value 3.841.
 */
export function kupiecStatistic(breaches: number, trials: number, p: number) {
    if (trials < 1 || !(p > 0 && p < 1) || breaches < 0 || breaches > trials) return null;
    const ph = breaches / trials;
    const lnNull = (trials - breaches) * Math.log(1 - p) + (breaches === 0 ? 0 : breaches * Math.log(p));
    const lnAlt = 
        breaches === 0 || breaches === trials 
            ? 0
            : (trials - breaches) * Math.log(1 - ph) + breaches * Math.log(ph);
    const likelihoodRatio = -2 * (lnNull - lnAlt);
    return {likelihoodRatio, rejectAt5Pct: likelihoodRatio > 3.841};
}

export function sampleCovarianceMatrix(columns: number[][]): number[][] {
    const n = columns.length;
    const cov = Array.from({length: n}, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
            const value = columns[i].length < 2 ? 0 : covariance(columns[i], columns[j]);
            cov[i][j] = value;
            cov[i][j] = value;
        }
    }
    return cov;
}

export function correlationMatrix(cov: number[][]): number[][] {
    return cov.map((row, i) =>
        row.map((value, j) => {
            const scale = Math.sqrt(Math.max(cov[i][i], 0) * Math.max(cov[j][j], 0));
            if (scale < 1e-18) return i === j ? 1 : 0;
            return value / scale;
        }))
}

export type RiskParts = {
    sigma: number;
    mctr: number[];
    cctr: number[];
    share: number[];
};

/** Component contributions sum to portfolio sigma. Shares sum to 1. */
export function portfolioRisk(weights: number[], cov: number[][]): RiskParts {
    const n = weights.length;
    const sigmaW = weights.map((_, i) => {
        let sum = 0;
        for (let j = 0; j < n; j++) sum += cov[i][j] * weights[j];
        return sum;
    });
    const variance = weights.reduce((sum, weight, i) => sum + weight * sigmaW[i], 0);
    const sigma = Math.sqrt(Math.max(variance, 0));
    if (sigma < 1e-12) {
        return {sigma: 0, mctr: weights.map(() => 0), cctr: weights.map(() => 0), share: weights.map(() => 0)}
    }
    const mctr = sigmaW.map((value) => value / sigma);
    const cctr = weights.map((weight, i) => weight * mctr[i]);
    const share = cctr.map((value) => value / sigma);
    return {sigma, mctr, cctr, share};
}

export function ulcerIndex(values: number[]): number {
    if (values.length === 0) return 0;
    let peak = -Infinity;
    let sum = 0;
    for (const value of values) {
        if (value > peak) peak = value;
        const drawdown = peak > 0 ? (value - peak) / peak : 0;
        sum += drawdown * drawdown;
    }
    return Math.sqrt(sum / values.length);
}

export type DrawdownEpisode = {
    peak: string;
    trough: string;
    recovered: string | null;
    depth: number;
    daysToTrough: number;
    daysToRecover: number | null;
};

export function drawdownEpisodes(
    series: {date: string; value: number}[],
    limit = 5
): DrawdownEpisode[] {
    if (series.length === 0) return [];
    let peak = series[0].value;
    let peakIdx = 0;
    let trough = series[0].value;
    let troughIdx = 0;
    let open = false;
    const episodes: DrawdownEpisode[] = [];

    const close = (recoveryIdx: number | null) => {
        const base = series[peakIdx].value;
        episodes.push({
            peak: series[peakIdx].date,
            trough: series[troughIdx].date,
            recovered: recoveryIdx == null ? null : series[recoveryIdx].date,
            depth: base > 0 ? (series[troughIdx].value - base) / base :0,
            daysToTrough: troughIdx - peakIdx,
            daysToRecover: recoveryIdx == null ? null : recoveryIdx - peakIdx,
        });
    };

    for (let i = 1; i < series.length; i++) {
        const value = series[i].value;
        if (value >= peak) {
            if (open) close(i);
            peak = value;
            peakIdx = i;
            trough = value;
            troughIdx = i;
            open = false;
        } else {
            open = true;
            if (value < trough) {
                trough = value;
                troughIdx = i;
            }
        }
    }

    if (open) close(null);

    return episodes.sort((a, b) => a.depth - b.depth).slice(0, limit);
}

export function rollingVolBeta(returns: number[], bench: number[], dates: string[], window: number) {
    const out: {date: string; vol: number; beta: number}[] = [];
    const n = Math.min(returns.length, bench.length, dates.length);
    for (let end = window; end <= n; end++) {
        const slice = returns.slice(end - window, end);
        const benchSlice = bench.slice(end - window, end);
        const benchVar = variance(benchSlice);
        out.push({
            date: dates[end - 1],
            vol: stdDev(slice) * Math.sqrt(TRADING_DAYS),
            beta: benchVar < 1e-18 ? 0 : covariance(slice, benchSlice) / benchVar,
        });
    }

    return out;
}