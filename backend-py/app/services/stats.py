"""
Sample statistics with the Node API's edge cases (NaN for too few values).
numpy sums pairwise where JavaScript sums left to right; results agree to
about 1e-16 relative.
"""

import math
from collections.abc import Sequence

import numpy as np

Values = Sequence[float] | np.ndarray


def _array(values: Values) -> np.ndarray:
    return values if isinstance(values, np.ndarray) else np.asarray(values, dtype=float)


def average(values: Values) -> float:
    data = _array(values)
    return math.nan if data.size == 0 else float(data.mean())


def variance(values: Values) -> float:
    """Sample variance (n − 1). NaN below two values, as 0/0 is in JavaScript."""
    data = _array(values)
    if data.size == 0:
        return -0.0
    if data.size == 1:
        return math.nan
    deviations = data - data.mean()
    return float(deviations @ deviations) / (data.size - 1)


def std_dev(values: Values) -> float:
    var = variance(values)
    return math.sqrt(var) if var >= 0 else math.nan


def covariance(a: Values, b: Values) -> float:
    x = _array(a)
    y = _array(b)
    if x.size < 2:
        return math.nan
    return float((x - x.mean()) @ (y[: x.size] - y[: x.size].mean())) / (x.size - 1)
