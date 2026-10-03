import math
from collections.abc import Sequence

from app.research.ols import ols


def ranks(values: Sequence[float]) -> list[float]:
    """1-based ranks; ties get the average of the ranks they span."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    out = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        rank = (i + j) / 2 + 1
        for k in range(i, j + 1):
            out[order[k]] = rank
        i = j + 1
    return out


def pearson(a: Sequence[float], b: Sequence[float]) -> float:
    n = len(a)
    if n < 2 or len(b) != n:
        return math.nan
    ma = sum_plain(a) / n
    mb = sum_plain(b) / n
    cov = va = vb = 0.0
    for i in range(n):
        cov += (a[i] - ma) * (b[i] - mb)
        va += (a[i] - ma) ** 2
        vb += (b[i] - mb) ** 2
    return cov / math.sqrt(va * vb) if va > 0 and vb > 0 else math.nan


def sum_plain(values: Sequence[float]) -> float:
    """Left-to-right sum, the way Array.reduce adds (Python's sum() compensates)."""
    total = 0.0
    for value in values:
        total += value
    return total


def spearman(a: Sequence[float], b: Sequence[float]) -> float:
    """Spearman rank correlation: the information coefficient of a ranking. NaN when either side is constant."""
    return pearson(ranks(a), ranks(b))


def rank_score(values: Sequence[float]) -> list[float]:
    """Rank scaled to [-0.5, 0.5], so every month's target has the same spread."""
    if len(values) < 2:
        return [0.0 for _ in values]
    return [(rank - 1) / (len(values) - 1) - 0.5 for rank in ranks(values)]


def newey_west_mean(series: Sequence[float], lag: int) -> dict[str, float] | None:
    """Mean of a series with a Newey–West standard error."""
    if len(series) < 3:
        return None
    fit = ols(list(series), [[] for _ in series], lag)
    return {"mean": fit["beta"][0], "se": fit["se"][0], "tStat": fit["tStat"][0]}


def qlike(realized_variance: float, forecast_variance: float) -> float:
    """Patton (2011) QLIKE on variances: zero for a perfect forecast, robust to noise in the realized proxy."""
    ratio = realized_variance / forecast_variance
    return ratio - math.log(ratio) - 1
