import math
from collections.abc import Mapping, Sequence
from typing import TypedDict

import numpy as np

from app.services.stats import average, covariance, std_dev, variance

# Identical returns do not cancel to exactly zero in floating point: the
# residue is around 1e-19, which is enough to divide by and produce a Sharpe
# of 1e17. Real daily dispersion never lands below these floors.
MIN_STD_DEV = 1e-12
MIN_VARIANCE = MIN_STD_DEV * MIN_STD_DEV


class DailyValue(TypedDict):
    date: str
    value: float


def to_daily_returns(series: Sequence[DailyValue]) -> list[float]:
    return [(series[i]["value"] - series[i - 1]["value"]) / series[i - 1]["value"] for i in range(1, len(series))]


def today_return(series: Sequence[DailyValue]) -> float:
    n = len(series)
    if n < 2:
        return 0.0
    return (series[n - 1]["value"] - series[n - 2]["value"]) / series[n - 2]["value"]


def _growth(daily_returns: Sequence[float] | np.ndarray) -> float:
    """Compounded growth, multiplied in order as the Node API does."""
    data = np.asarray(daily_returns, dtype=float)
    return float(np.cumprod(1 + data)[-1]) if data.size else 1.0


def annualized_return(daily_returns: Sequence[float] | np.ndarray, trading_days_per_year: int = 252) -> float:
    if len(daily_returns) == 0:
        return 0.0
    total = _growth(daily_returns)
    if total <= 0:
        return -1.0
    years = len(daily_returns) / trading_days_per_year
    return total ** (1 / years) - 1


def cagr(start_value: float, end_value: float, years: float) -> float:
    if start_value <= 0 or end_value <= 0 or years <= 0:
        return 0.0
    return (end_value / start_value) ** (1 / years) - 1


def cagr_from_returns(daily_returns: Sequence[float] | np.ndarray, years: float) -> float:
    return cagr(1, _growth(daily_returns), years)


def max_drawdown_from_returns(daily_returns: Sequence[float] | np.ndarray) -> float:
    data = np.asarray(daily_returns, dtype=float)
    if data.size == 0:
        return 0.0
    level = np.cumprod(1 + data)
    peak = np.maximum.accumulate(np.maximum(level, 1.0))
    return min(0.0, float(((level - peak) / peak).min()))


def volatility(daily_returns: Sequence[float] | np.ndarray, trading_days_per_year: int = 252) -> float:
    return std_dev(daily_returns) * math.sqrt(trading_days_per_year)


def sharpe_ratio(daily_returns: Sequence[float] | np.ndarray, risk_free_annual_rate: float, trading_days_per_year: int = 252) -> float:
    rf_daily = risk_free_annual_rate / trading_days_per_year
    excess = np.asarray(daily_returns, dtype=float) - rf_daily
    std = std_dev(excess)
    if not math.isfinite(std) or std < MIN_STD_DEV:
        return 0.0
    return average(excess) / std * math.sqrt(trading_days_per_year)


def sharpe_standard_error(daily_returns: Sequence[float] | np.ndarray, risk_free_annual_rate: float, trading_days_per_year: int = 252) -> float:
    """Asymptotic standard error of the Sharpe ratio, on the same annualised scale as `sharpe_ratio`."""
    n = len(daily_returns)
    if n < 2:
        return 0.0
    rf_daily = risk_free_annual_rate / trading_days_per_year
    excess = np.asarray(daily_returns, dtype=float) - rf_daily
    std = std_dev(excess)
    if not math.isfinite(std) or std < MIN_STD_DEV:
        return 0.0
    sr_daily = average(excess) / std
    return math.sqrt((1 + 0.5 * sr_daily * sr_daily) / n) * math.sqrt(trading_days_per_year)


def beta(portfolio_returns: Sequence[float], benchmark_returns: Sequence[float]) -> float:
    bench_variance = variance(benchmark_returns)
    if not math.isfinite(bench_variance) or bench_variance < MIN_VARIANCE:
        return 0.0
    return covariance(portfolio_returns, benchmark_returns) / bench_variance


def alpha(portfolio_annual_return: float, benchmark_annual_return: float, risk_free_annual_rate: float, beta_value: float) -> float:
    return portfolio_annual_return - (risk_free_annual_rate + beta_value * (benchmark_annual_return - risk_free_annual_rate))


def max_drawdown(series: Sequence[DailyValue]) -> float:
    peak = -math.inf
    max_dd = 0.0
    for point in series:
        if point["value"] > peak:
            peak = point["value"]
        drawdown = (point["value"] - peak) / peak if peak != 0 else math.nan
        if drawdown < max_dd:
            max_dd = drawdown
    return max_dd


def composite_benchmark_returns(klci: Sequence[float], sp500: Sequence[float], bursa_weight: float, us_weight: float) -> list[float]:
    return [r * bursa_weight + sp500[i] * us_weight for i, r in enumerate(klci)]


def index_to_100(series: Sequence[DailyValue]) -> list[dict[str, float | str]]:
    if len(series) == 0:
        return []
    start = series[0]["value"]
    if start <= 0:
        return [{"date": point["date"], "indexedValue": 100} for point in series]
    return [{"date": point["date"], "indexedValue": point["value"] / start * 100} for point in series]


def time_weighted_index(
    values: Sequence[DailyValue],
    cash_flow_by_date: Mapping[str, float],
    income_by_date: Mapping[str, float] | None = None,
) -> list[DailyValue]:
    """
    Index starting at 100. Cash flows (money in +, out −) are removed so deposits
    do not read as performance; dividend income going ex is added back.
    """
    if len(values) == 0:
        return []
    income = income_by_date or {}
    out: list[DailyValue] = [{"date": values[0]["date"], "value": 100.0}]
    indexed = 100.0
    for i in range(1, len(values)):
        prev = values[i - 1]["value"]
        curr = values[i]["value"]
        flow = cash_flow_by_date.get(values[i]["date"], 0.0)
        div = income.get(values[i]["date"], 0.0)
        daily = (curr - prev - flow + div) / prev if prev > 1e-6 else 0.0
        indexed *= 1 + daily
        out.append({"date": values[i]["date"], "value": indexed})
    return out
