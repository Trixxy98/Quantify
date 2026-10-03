import {invert} from "./ols";

/**
 * Ridge without an intercept: minimises mean squared error + lambda * |beta|².
 * Callers standardise features and demean the target first, so the penalty
 * means the same thing whatever the sample size.
 */
export function ridge(x: number[][], y: number[], lambda: number): number[] {
    const n = y.length;
    if (n === 0 || x.length !== n) throw new Error("ridge: x and y must have the same non-zero length");
    if (!(lambda >= 0)) throw new Error("ridge: lambda must be non-negative");
    const k = x[0].length;
    const a = Array.from({length: k}, () => Array<number>(k).fill(0));
    const b = Array<number>(k).fill(0);
    for (let t = 0; t < n; t++) {
        const row = x[t];
        for (let i = 0; i < k; i++) {
            b[i] += row[i] * y[t];
            for (let j = 0; j < k; j++) a[i][j] += row[i] * row[j];
        }
    }
    for (let i = 0; i < k; i++) {
        b[i] /= n;
        for (let j = 0; j < k; j++) a[i][j] /= n;
        a[i][i] += lambda;
    }
    const inverse = invert(a);
    return inverse.map((row) => row.reduce((sum, value, j) => sum + value * b[j], 0));
}

export function predict(beta: number[], row: number[]): number {
    return row.reduce((sum, value, i) => sum + value * beta[i], 0);
}
