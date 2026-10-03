export type OlsResult = {
    /** Intercept first, then one coefficient per column of `x`. */
    beta: number[];
    se: number[];
    tStat: number[];
    n: number;
    rSquared: number;
};

/**
 * OLS with Newey–West standard errors. `lag` is the maximum autocorrelation
 * the variance estimate allows for; 0 is the White (HC0) estimator.
 * `x` is observations × regressors and does not include a column of ones.
 */
export function ols(y: number[], x: number[][], lag = 5): OlsResult {
    const n = y.length;
    if (n === 0 || x.length !== n) throw new Error("ols: y and x must have the same non-zero length");
    const regressors = x[0].length;
    const k = regressors + 1;
    if (n <= k) throw new Error("ols: need more observations than parameters");

    const X = x.map((row) => [1, ...row]);
    const xtx = gram(X);
    const xty = Array.from({length: k}, (_, j) => X.reduce((sum, row, t) => sum + row[j] * y[t], 0));
    const xtxInv = invert(xtx);
    const beta = multiply(xtxInv, xty);

    const resid = y.map((value, t) => value - dot(X[t], beta));
    const maxLag = Math.min(Math.max(0, lag), n - 1);
    const omega = meat(X, resid, maxLag);
    const variance = sandwich(xtxInv, omega);

    const mean = y.reduce((sum, value) => sum + value, 0) / n;
    const ssTot = y.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    const ssRes = resid.reduce((sum, value) => sum + value ** 2, 0);

    return {
        beta,
        se: variance.map((row, i) => Math.sqrt(Math.max(0, row[i]))),
        tStat: beta.map((value, i) => {
            const se = Math.sqrt(Math.max(0, variance[i][i]));
            return se > 0 ? value / se : 0;
        }),
        n,
        rSquared: ssTot > 0 ? 1 - ssRes / ssTot : 1,
    };
}

function dot(a: number[], b: number[]): number {
    return a.reduce((sum, value, i) => sum + value * b[i], 0);
}

function gram(X: number[][]): number[][] {
    const k = X[0].length;
    const out = Array.from({length: k}, () => Array(k).fill(0));
    for (const row of X) {
        for (let i = 0; i < k; i++) {
            for (let j = i; j < k; j++) out[i][j] += row[i] * row[j];
        }
    }
    for (let i = 0; i < k; i++) {
        for (let j = 0; j < i; j++) out[i][j] = out[j][i];
    }
    return out;
}

/** Newey–West meat matrix. Lag weights are Bartlett: 1 − l/(L+1). */
function meat(X: number[][], resid: number[], lag: number): number[][] {
    const n = X.length;
    const k = X[0].length;
    const omega = Array.from({length: k}, () => Array(k).fill(0));
    for (let t = 0; t < n; t++) {
        addOuter(omega, resid[t] * resid[t], X[t], X[t]);
    }
    for (let l = 1; l <= lag; l++) {
        const weight = 1 - l / (lag + 1);
        for (let t = l; t < n; t++) {
            const scale = weight * resid[t] * resid[t - l];
            addOuter(omega, scale, X[t], X[t - l]);
            addOuter(omega, scale, X[t - l], X[t]);
        }
    }
    return omega;
}

function addOuter(target: number[][], scale: number, a: number[], b: number[]) {
    for (let i = 0; i < a.length; i++) {
        for (let j = 0; j < b.length; j++) target[i][j] += scale * a[i] * b[j];
    }
}

function sandwich(xtxInv: number[][], omega: number[][]): number[][] {
    return multiplyMatrices(multiplyMatrices(xtxInv, omega), xtxInv);
}

function multiply(matrix: number[][], vector: number[]): number[] {
    return matrix.map((row) => dot(row, vector));
}

function multiplyMatrices(a: number[][], b: number[][]): number[][] {
    const cols = b[0].length;
    return a.map((row) =>
        Array.from({length: cols}, (_, j) => row.reduce((sum, value, i) => sum + value * b[i][j], 0))
    );
}

export function invert(matrix: number[][]): number[][] {
    const n = matrix.length;
    const a = matrix.map((row, i) => {
        const extended = [...row];
        for (let j = 0; j < n; j++) extended.push(i === j ? 1 : 0);
        return extended;
    });

    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let row = col + 1; row < n; row++) {
            if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
        }
        if (Math.abs(a[pivot][col]) < 1e-14) throw new Error("ols: regressors are collinear");
        [a[col], a[pivot]] = [a[pivot], a[col]];
        const scale = a[col][col];
        for (let j = col; j < a[col].length; j++) a[col][j] /= scale;
        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const factor = a[row][col];
            for (let j = col; j < a[row].length; j++) a[row][j] -= factor * a[col][j];
        }
    }
    return a.map((row) => row.slice(n));
}
