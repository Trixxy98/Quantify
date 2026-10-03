from collections.abc import Sequence

import numpy as np
from sklearn.linear_model import Ridge


def ridge(x: Sequence[Sequence[float]], y: Sequence[float], lam: float) -> list[float]:
    """
    Ridge without an intercept, minimising mean squared error + lam·|beta|².
    scikit-learn minimises the summed squared error + alpha·|beta|², so
    alpha = lam·n. Callers standardise features and demean the target first.
    """
    n = len(y)
    if n == 0 or len(x) != n:
        raise ValueError("ridge: x and y must have the same non-zero length")
    if not lam >= 0:
        raise ValueError("ridge: lambda must be non-negative")
    design = np.asarray(x, dtype=float)
    target = np.asarray(y, dtype=float)
    if lam == 0:
        beta, *_ = np.linalg.lstsq(design, target, rcond=None)
        return [float(value) for value in beta]
    model = Ridge(alpha=lam * n, fit_intercept=False, solver="cholesky")
    model.fit(design, target)
    return [float(value) for value in model.coef_]


def predict(beta: Sequence[float], row: Sequence[float]) -> float:
    total = 0.0
    for i, value in enumerate(row):
        total += value * beta[i]
    return total
