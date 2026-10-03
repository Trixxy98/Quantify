from collections.abc import Sequence
from typing import TypedDict

import numpy as np
import statsmodels.api as sm

# The Node API's Gauss–Jordan solve gave up on a pivot below this; statsmodels
# would answer anyway through a pseudo-inverse, so the check is kept explicit.
COLLINEAR_CONDITION = 1e14


class CollinearError(ValueError):
    pass


class OlsResult(TypedDict):
    beta: list[float]  # intercept first, then one per column of x
    se: list[float]
    tStat: list[float]
    n: int
    rSquared: float


def ols(y: Sequence[float], x: Sequence[Sequence[float]], lag: int = 5) -> OlsResult:
    """
    OLS with Newey–West (Bartlett) standard errors and no small-sample
    correction. `lag` is the maximum autocorrelation allowed for; 0 is White
    (HC0). `x` is observations × regressors without the column of ones.
    """
    n = len(y)
    if n == 0 or len(x) != n:
        raise ValueError("ols: y and x must have the same non-zero length")
    regressors = len(x[0])
    k = regressors + 1
    if n <= k:
        raise ValueError("ols: need more observations than parameters")

    design = np.column_stack([np.ones(n), np.asarray(x, dtype=float).reshape(n, regressors)])
    target = np.asarray(y, dtype=float)
    gram = design.T @ design
    if np.linalg.matrix_rank(gram) < k or np.linalg.cond(gram) > COLLINEAR_CONDITION:
        raise CollinearError("ols: regressors are collinear")

    max_lag = min(max(0, lag), n - 1)
    fit = sm.OLS(target, design, hasconst=True).fit(cov_type="HAC", cov_kwds={"maxlags": max_lag, "use_correction": False})
    beta = [float(value) for value in fit.params]
    se = [float(np.sqrt(max(0.0, value))) for value in np.diag(fit.cov_params())]
    resid = target - design @ fit.params
    ss_res = float(resid @ resid)
    centred = target - target.mean()
    ss_tot = float(centred @ centred)
    return {
        "beta": beta,
        "se": se,
        "tStat": [b / s if s > 0 else 0.0 for b, s in zip(beta, se, strict=True)],
        "n": n,
        "rSquared": 1 - ss_res / ss_tot if ss_tot > 0 else 1.0,
    }
