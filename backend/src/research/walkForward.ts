export type Fold = {
    trainStart: number;
    trainEnd: number;
    testStart: number;
    testEnd: number;
};

/**
 * Rolling train window, then a test window that starts where training ends.
 * The last fold is dropped when the remaining observations cannot fill a whole
 * test window. Test windows do not overlap when `step` is at least `test`.
 */
export function walkForwardFolds(n: number, train: number, test: number, step: number): Fold[] {
    if (train < 1 || test < 1 || step < 1) throw new Error("walk-forward windows must be positive");
    const folds: Fold[] = [];
    for (let start = 0; start + train + test <= n; start += step) {
        folds.push({
            trainStart: start,
            trainEnd: start + train,
            testStart: start + train,
            testEnd: start + train + test,
        });
    }
    return folds;
}

export type WalkForwardFold<P> = Fold & {params: P};

/**
 * `fit` sees only [trainStart, trainEnd). `apply` sees only [testStart, testEnd)
 * and must return one number per test observation. The returned series is the
 * concatenation of those out-of-sample results.
 */
export function walkForward<P>(
    n: number,
    train: number,
    test: number,
    step: number,
    fit: (trainStart: number, trainEnd: number) => P,
    apply: (params: P, testStart: number, testEnd: number) => number[]
): {returns: number[]; folds: WalkForwardFold<P>[]} {
    const folds = walkForwardFolds(n, train, test, step);
    const returns: number[] = [];
    const detailed: WalkForwardFold<P>[] = [];
    for (const fold of folds) {
        const params = fit(fold.trainStart, fold.trainEnd);
        const out = apply(params, fold.testStart, fold.testEnd);
        if (out.length !== fold.testEnd - fold.testStart) {
            throw new Error("walk-forward apply must return one value per test observation");
        }
        returns.push(...out);
        detailed.push({...fold, params});
    }
    return {returns, folds: detailed};
}
