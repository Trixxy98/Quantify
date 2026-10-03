import {ols} from "../ols";

/** 1-based ranks, ties get the average of the ranks they span. */
export function ranks(values: number[]): number[] {
    const order = values.map((value, index) => ({value, index})).sort((a, b) => a.value - b.value);
    const out = new Array<number>(values.length);
    let i = 0;
    while (i < order.length) {
        let j = i;
        while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
        const rank = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) out[order[k].index] = rank;
        i = j + 1;
    }
    return out;
}

export function pearson(a: number[], b: number[]): number {
    const n = a.length;
    if (n < 2 || b.length !== n) return Number.NaN;
    const ma = a.reduce((sum, value) => sum + value, 0) / n;
    const mb = b.reduce((sum, value) => sum + value, 0) / n;
    let cov = 0;
    let va = 0;
    let vb = 0;
    for (let i = 0; i < n; i++) {
        cov += (a[i] - ma) * (b[i] - mb);
        va += (a[i] - ma) ** 2;
        vb += (b[i] - mb) ** 2;
    }
    return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : Number.NaN;
}

/** Spearman rank correlation, i.e. the information coefficient of a ranking. NaN when either side is constant. */
export function spearman(a: number[], b: number[]): number {
    return pearson(ranks(a), ranks(b));
}

/** Rank scaled to [-0.5, 0.5], so every month's target has the same spread whatever the market did. */
export function rankScore(values: number[]): number[] {
    if (values.length < 2) return values.map(() => 0);
    return ranks(values).map((rank) => (rank - 1) / (values.length - 1) - 0.5);
}

/** Mean of a series with a Newey–West standard error. */
export function neweyWestMean(series: number[], lag: number): {mean: number; se: number; tStat: number} | null {
    if (series.length < 3) return null;
    const fit = ols(series, series.map(() => []), lag);
    return {mean: fit.beta[0], se: fit.se[0], tStat: fit.tStat[0]};
}

/** Patton (2011) QLIKE on variances: zero for a perfect forecast, robust to noise in the realized proxy. */
export function qlike(realizedVariance: number, forecastVariance: number): number {
    const ratio = realizedVariance / forecastVariance;
    return ratio - Math.log(ratio) - 1;
}
