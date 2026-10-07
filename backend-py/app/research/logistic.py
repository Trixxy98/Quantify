"""Binary logistic regression by IRLS (Newton–Raphson). Used by Quant and Risk (b)."""

from collections.abc import Sequence
from typing import TypedDict

import numpy as np

from app.research.ols import COLLINEAR_CONDITION, CollinearError

MAX_ITER = 25
TOL = 1e-8
# Keep fitted probabilities off the 0/1 walls so log-likelihood stays finite.
PROB_FLOOR = 1e-12


class LogisticResult(TypedDict):
    beta: list[float]  # intercept first, then one per column of x
    n: int
    iterations: int
    converged: bool


def _sigmoid(eta: np.ndarray) -> np.ndarray:
    # Stable: clip the linear predictor before exp.
    clipped = np.clip(eta, -35.0, 35.0)
    return 1.0 / (1.0 + np.exp(-clipped))


def logistic(y: Sequence[float | int | bool], x: Sequence[Sequence[float]]) -> LogisticResult:
    """
    Fit P(y=1 | x) = sigmoid(β₀ + x·β). `x` is observations × regressors without the
    column of ones. `y` must be 0/1 (bools and 0.0/1.0 are fine). Raises CollinearError
    when the weighted design is singular, matching `ols`.
    """
    n = len(y)
    if n == 0 or len(x) != n:
        raise ValueError("logistic: y and x must have the same non-zero length")
    target = np.asarray(y, dtype=float)
    if not np.all((target == 0) | (target == 1)):
        raise ValueError("logistic: y must be 0 or 1")
    if target.min() == target.max():
        raise ValueError("logistic: y has only one class")

    regressors = len(x[0])
    k = regressors + 1
    if n <= k:
        raise ValueError("logistic: need more observations than parameters")

    design = np.column_stack([np.ones(n), np.asarray(x, dtype=float).reshape(n, regressors)])
    beta = np.zeros(k)
    converged = False
    iterations = 0

    for step_i in range(1, MAX_ITER + 1):
        iterations = step_i
        eta = design @ beta
        mu = _sigmoid(eta)
        # Bernoulli weight: μ(1-μ); floor so a near-certain fit cannot zero a row.
        weight = np.clip(mu * (1.0 - mu), PROB_FLOOR, None)
        # Working response from the current linearisation.
        z = eta + (target - mu) / weight
        w_sqrt = np.sqrt(weight)
        weighted_design = design * w_sqrt[:, None]
        weighted_z = z * w_sqrt
        gram = weighted_design.T @ weighted_design
        if np.linalg.matrix_rank(gram) < k or np.linalg.cond(gram) > COLLINEAR_CONDITION:
            raise CollinearError("logistic: regressors are collinear")
        step = np.linalg.solve(gram, weighted_design.T @ weighted_z)
        if float(np.max(np.abs(step - beta))) < TOL:
            beta = step
            converged = True
            break
        beta = step

    return {
        "beta": [float(value) for value in beta],
        "n": n,
        "iterations": iterations,
        "converged": converged,
    }


def predict_proba(beta: Sequence[float], x: Sequence[Sequence[float]]) -> list[float]:
    """P(y=1) for each row of `x` (no intercept column; β[0] is the intercept)."""
    if not beta:
        raise ValueError("predict_proba: beta is empty")
    regressors = len(beta) - 1
    design = np.column_stack([np.ones(len(x)), np.asarray(x, dtype=float).reshape(len(x), regressors)])
    mu = _sigmoid(design @ np.asarray(beta, dtype=float))
    return [float(value) for value in mu]


def brier_score(forecasts: Sequence[float], outcomes: Sequence[float | int | bool]) -> float:
    """Mean squared error of probability forecasts. Lower is better."""
    if len(forecasts) == 0 or len(forecasts) != len(outcomes):
        raise ValueError("brier_score: forecasts and outcomes must have the same non-zero length")
    f = np.asarray(forecasts, dtype=float)
    y = np.asarray(outcomes, dtype=float)
    return float(np.mean((f - y) ** 2))


def brier_skill_score(forecasts: Sequence[float], outcomes: Sequence[float | int | bool]) -> float:
    """
    1 - Brier(model) / Brier(climatology), where climatology is the sample base rate.
    Positive means better than always forecasting the mean outcome rate.
    """
    values = [float(value) for value in outcomes]
    if len(values) == 0:
        raise ValueError("brier_skill_score: empty outcomes")
    base_rate = float(np.mean(values))
    climate = brier_score([base_rate] * len(values), values)
    if climate < 1e-18:
        return 0.0
    return 1.0 - brier_score(forecasts, values) / climate
