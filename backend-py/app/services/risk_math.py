import math
from collections.abc import Sequence
from typing import Any

from app.services.stats import covariance, std_dev, variance

TRADING_DAYS = 252


def garman_klass_daily(open_: float, high: float, low: float, close: float) -> float | None:
    """Garman–Klass daily variance. None when a print is missing or the bar is invalid."""
    if not (open_ > 0 and high > 0 and low > 0 and close > 0) or high < low:
        return None
    log_hl = math.log(high / low)
    log_co = math.log(close / open_)
    value = 0.5 * log_hl * log_hl - (2 * math.log(2) - 1) * log_co * log_co
    return value if value > 0 else 0.0


def annualized_vol_from_daily_variances(daily_variances: Sequence[float]) -> float:
    if len(daily_variances) == 0:
        return 0.0
    total = 0.0
    for value in daily_variances:
        total += value
    mean = total / len(daily_variances)
    return math.sqrt(max(mean, 0) * TRADING_DAYS)


def quantile(values: Sequence[float], p: float) -> float:
    """Nearest-rank quantile. p = 0.05 is the historical 95% VaR threshold."""
    if len(values) == 0:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(p * len(ordered)) - 1))
    return ordered[index]


def expected_shortfall(values: Sequence[float], p: float) -> float:
    if len(values) == 0:
        return 0.0
    cutoff = quantile(values, p)
    tail = [value for value in values if value <= cutoff]
    if not tail:
        return cutoff
    total = 0.0
    for value in tail:
        total += value
    return total / len(tail)


def kupiec_statistic(breaches: int, trials: int, p: float) -> dict[str, Any] | None:
    """Kupiec proportion-of-failures test; rejects at 5% above the chi-square(1) value 3.841."""
    if trials < 1 or not (0 < p < 1) or breaches < 0 or breaches > trials:
        return None
    ph = breaches / trials
    ln_null = (trials - breaches) * math.log(1 - p) + (0 if breaches == 0 else breaches * math.log(p))
    ln_alt = 0 if breaches in (0, trials) else (trials - breaches) * math.log(1 - ph) + breaches * math.log(ph)
    ratio = -2 * (ln_null - ln_alt)
    return {"likelihoodRatio": ratio, "rejectAt5Pct": ratio > 3.841}


def sample_covariance_matrix(columns: Sequence[Sequence[float]]) -> list[list[float]]:
    n = len(columns)
    cov = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i, n):
            value = 0.0 if len(columns[i]) < 2 else covariance(columns[i], columns[j])
            cov[i][j] = value
            cov[j][i] = value
    return cov


def correlation_matrix(cov: Sequence[Sequence[float]]) -> list[list[float]]:
    out = []
    for i, row in enumerate(cov):
        out_row = []
        for j, value in enumerate(row):
            scale = math.sqrt(max(cov[i][i], 0) * max(cov[j][j], 0))
            out_row.append((1.0 if i == j else 0.0) if scale < 1e-18 else value / scale)
        out.append(out_row)
    return out


def erc_weights(cov: Sequence[Sequence[float]], iterations: int = 2000) -> list[float] | None:
    """Long-only fully invested weights with equal component contribution to volatility.

    Each step moves halfway toward the Spinu update, so a tiny or negative risk share
    raises the weight instead of dropping the name to zero.
    """
    n = len(cov)
    if n == 0:
        return []
    if any(len(row) != n for row in cov):
        return None
    if n == 1:
        return [1.0]
    weights = [1 / n] * n
    budget = 1 / n
    for _ in range(iterations):
        parts = portfolio_risk(weights, cov)
        if parts["sigma"] <= 0:
            return weights
        if max(parts["share"]) - min(parts["share"]) < 1e-8:
            return weights
        nxt = []
        for i in range(n):
            share = parts["share"][i]
            step = weights[i] * 1.25 if share <= 1e-12 else weights[i] * (budget / share) ** 0.5
            nxt.append(max(step, 0.0))
        total = sum(nxt)
        if total <= 0:
            return None
        weights = [value / total for value in nxt]
    return weights


def constant_correlation_shrink(columns: Sequence[Sequence[float]]) -> tuple[list[list[float]], float]:
    """Ledoit–Wolf constant-correlation target. The intensity is clipped to [0, 1]."""
    cov = sample_covariance_matrix(columns)
    n = len(cov)
    length = len(columns[0]) if columns else 0
    std = [math.sqrt(max(cov[i][i], 0)) for i in range(n)]
    pairs = [cov[i][j] / (std[i] * std[j]) for i in range(n) for j in range(i + 1, n) if std[i] > 0 and std[j] > 0]
    rho = max(-0.99, min(0.99, sum(pairs) / len(pairs))) if pairs else 0.0
    target = [[cov[i][i] if i == j else rho * std[i] * std[j] for j in range(n)] for i in range(n)]
    if length < 3 or n == 0:
        return cov, 0.0
    means = [sum(column) / len(column) for column in columns]
    noise = 0.0
    for i in range(n):
        for j in range(n):
            acc = 0.0
            for k in range(length):
                dev = (columns[i][k] - means[i]) * (columns[j][k] - means[j]) - cov[i][j]
                acc += dev * dev
            noise += acc / (length * (length - 1))
    gap = sum((cov[i][j] - target[i][j]) ** 2 for i in range(n) for j in range(n))
    intensity = 0.0 if gap <= 0 else max(0.0, min(1.0, noise / gap))
    shrunk = [[(1 - intensity) * cov[i][j] + intensity * target[i][j] for j in range(n)] for i in range(n)]
    return shrunk, intensity


def portfolio_risk(weights: Sequence[float], cov: Sequence[Sequence[float]]) -> dict[str, Any]:
    """Component contributions sum to portfolio sigma. Shares sum to 1."""
    n = len(weights)
    sigma_w = []
    for i in range(n):
        total = 0.0
        for j in range(n):
            total += cov[i][j] * weights[j]
        sigma_w.append(total)
    var = 0.0
    for i, weight in enumerate(weights):
        var += weight * sigma_w[i]
    sigma = math.sqrt(max(var, 0))
    if sigma < 1e-12:
        zeros = [0.0] * n
        return {"sigma": 0.0, "mctr": zeros, "cctr": list(zeros), "share": list(zeros)}
    mctr = [value / sigma for value in sigma_w]
    cctr = [weight * mctr[i] for i, weight in enumerate(weights)]
    share = [value / sigma for value in cctr]
    return {"sigma": sigma, "mctr": mctr, "cctr": cctr, "share": share}


def ulcer_index(values: Sequence[float]) -> float:
    if len(values) == 0:
        return 0.0
    peak = -math.inf
    total = 0.0
    for value in values:
        if value > peak:
            peak = value
        drawdown = (value - peak) / peak if peak > 0 else 0.0
        total += drawdown * drawdown
    return math.sqrt(total / len(values))


def drawdown_episodes(series: Sequence[dict[str, Any]], limit: int = 5) -> list[dict[str, Any]]:
    if len(series) == 0:
        return []
    peak = series[0]["value"]
    peak_idx = 0
    trough = series[0]["value"]
    trough_idx = 0
    is_open = False
    episodes: list[dict[str, Any]] = []

    def close(recovery_idx: int | None) -> None:
        base = series[peak_idx]["value"]
        episodes.append(
            {
                "peak": series[peak_idx]["date"],
                "trough": series[trough_idx]["date"],
                "recovered": None if recovery_idx is None else series[recovery_idx]["date"],
                "depth": (series[trough_idx]["value"] - base) / base if base > 0 else 0,
                "daysToTrough": trough_idx - peak_idx,
                "daysToRecover": None if recovery_idx is None else recovery_idx - peak_idx,
            }
        )

    for i in range(1, len(series)):
        value = series[i]["value"]
        if value >= peak:
            if is_open:
                close(i)
            peak = value
            peak_idx = i
            trough = value
            trough_idx = i
            is_open = False
        else:
            is_open = True
            if value < trough:
                trough = value
                trough_idx = i
    if is_open:
        close(None)
    return sorted(episodes, key=lambda episode: episode["depth"])[:limit]


def rolling_vol_beta(returns: Sequence[float], bench: Sequence[float], dates: Sequence[str], window: int) -> list[dict[str, Any]]:
    out = []
    n = min(len(returns), len(bench), len(dates))
    for end in range(window, n + 1):
        chunk = list(returns[end - window : end])
        bench_chunk = list(bench[end - window : end])
        bench_var = variance(bench_chunk)
        out.append(
            {
                "date": dates[end - 1],
                "vol": std_dev(chunk) * math.sqrt(TRADING_DAYS),
                "beta": 0 if bench_var < 1e-18 else covariance(chunk, bench_chunk) / bench_var,
            }
        )
    return out
