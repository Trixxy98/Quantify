import math
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from app.research.agents.monthly import is_fresh, shift_month, symbol_months
from app.research.agents.types import Agent, AgentInput, AgentOutput, AgentPrediction, SymbolSeries
from app.research.ols import ols
from app.research.walk_forward import expanding_folds
from app.services.risk_math import garman_klass_daily

RISK_VERSION = "risk-har-v1"
HAR_MIN_TRAIN_MONTHS = 60
HAR_REFIT_MONTHS = 12
TRADING_DAYS = 252
WEEK = 5
MONTH = 22
# A target month with fewer usable bars than this is not a measurement of that month's vol.
MIN_TARGET_SESSIONS = 10
# Fewer daily rows than this (about a year) and the four coefficients are noise.
MIN_FIT_ROWS = 250

HarRegressors = tuple[float, float, float]


@dataclass
class HarSample:
    """A month-end forecast point; `feature` is the session the regressors are read at."""

    month: str
    feature: int
    x: HarRegressors
    y: float | None


@dataclass
class HarRow:
    """A daily estimation row: regressors at one session, target over the next MONTH sessions, known at `target_end`."""

    target_end: int
    x: HarRegressors
    y: float | None


@dataclass
class HarFit:
    beta: list[float]
    floor: float


def _finite_mean(values: list[float], minimum: int) -> float:
    finite = [value for value in values if math.isfinite(value)]
    if len(finite) < minimum:
        return math.nan
    total = 0.0
    for value in finite:
        total += value
    return total / len(finite)


def daily_variances(series: SymbolSeries) -> list[float]:
    out = []
    for i in range(len(series.dates)):
        value = garman_klass_daily(series.open[i], series.high[i], series.low[i], series.close[i])
        out.append(math.nan if value is None else value)
    return out


def _regressors(gk: list[float], i: int) -> HarRegressors | None:
    """Corsi (2009) regressors at session i: that day's, the last week's and the last month's mean daily variance."""
    if i < MONTH - 1:
        return None
    x = (gk[i], _finite_mean(gk[i - WEEK + 1 : i + 1], 3), _finite_mean(gk[i - MONTH + 1 : i + 1], 15))
    return x if all(math.isfinite(value) for value in x) else None


def _window_means(gk: np.ndarray, starts: np.ndarray, ends: np.ndarray, minimum: int) -> np.ndarray:
    """Mean of the finite values in each [start, end) window, NaN when fewer than `minimum` are finite."""
    finite = np.isfinite(gk)
    sums = np.concatenate([[0.0], np.cumsum(np.where(finite, gk, 0.0))])
    counts = np.concatenate([[0], np.cumsum(finite)])
    n = counts[ends] - counts[starts]
    with np.errstate(invalid="ignore", divide="ignore"):
        means = (sums[ends] - sums[starts]) / n
    return np.where(n >= minimum, means, np.nan)


def har_rows(series: SymbolSeries) -> list[HarRow]:
    """Daily rows with overlapping targets, the way Corsi estimates HAR."""
    gk = np.asarray(daily_variances(series), dtype=float)
    index = np.arange(MONTH - 1, len(gk) - MONTH)
    if len(index) == 0:
        return []
    daily = gk[index]
    weekly = _window_means(gk, index - WEEK + 1, index + 1, 3)
    monthly = _window_means(gk, index - MONTH + 1, index + 1, 15)
    target = _window_means(gk, index + 1, index + MONTH + 1, MIN_TARGET_SESSIONS)
    usable = np.isfinite(daily) & np.isfinite(weekly) & np.isfinite(monthly)
    return [
        HarRow(int(i) + MONTH, (float(d), float(w), float(m)), float(y) if math.isfinite(y) else None)
        for i, d, w, m, y in zip(index[usable], daily[usable], weekly[usable], monthly[usable], target[usable], strict=True)
    ]


def har_samples(series: SymbolSeries) -> list[HarSample]:
    """Month-end forecast points; the outcome is the mean daily variance over the following month's sessions."""
    gk = daily_variances(series)
    months = symbol_months(series)
    samples = []
    for month, end in months.items():
        x = _regressors(gk, end.feature)
        if x is None:
            continue
        nxt = months.get(shift_month(month, 1))
        y = _finite_mean(gk[end.index + 1 : nxt.index + 1], MIN_TARGET_SESSIONS) if nxt else math.nan
        samples.append(HarSample(month, end.feature, x, y if math.isfinite(y) else None))
    return sorted(samples, key=lambda sample: sample.month)


def fit_har(samples: Sequence[HarRow | HarSample]) -> HarFit | None:
    known = [(sample.x, sample.y) for sample in samples if sample.y is not None]
    if len(known) < MIN_FIT_ROWS:
        return None
    targets = [y for _, y in known]
    try:
        result = ols(targets, [x for x, _ in known], 0)
    except ValueError:
        return None
    # Never forecast below the calmest stretch seen in training; a negative variance is not a forecast.
    return HarFit(result["beta"], min(targets))


def har_forecast(fit: HarFit, x: HarRegressors) -> float:
    value = fit.beta[0] + fit.beta[1] * x[0] + fit.beta[2] * x[1] + fit.beta[3] * x[2]
    return max(value, fit.floor)


def _to_vol(variance: float) -> float:
    return math.sqrt(TRADING_DAYS * variance)


def run_risk_vol(data: AgentInput) -> AgentOutput:
    as_of_month = data.as_of[:7]
    predictions: list[AgentPrediction] = []
    short: list[str] = []
    for series in data.series:
        samples = har_samples(series)
        rows = har_rows(series)
        last_date = series.dates[-1] if series.dates else None
        live = next((sample for sample in samples if sample.month == as_of_month), None)
        # A name whose bars stop before the month end would be forecast from stale data.
        usable = [sample for sample in samples if sample is not live] if live and last_date and not is_fresh(last_date, data.as_of) else samples
        folds = expanding_folds(len(usable), HAR_MIN_TRAIN_MONTHS, HAR_REFIT_MONTHS)
        if not folds:
            short.append(series.symbol)
        for fold in folds:
            test = usable[fold.test_start : fold.test_end]
            # Only rows whose 22-session outcome was complete before the first test month's inputs were read.
            fit = fit_har([row for row in rows if row.target_end <= test[0].feature])
            if fit is None:
                continue
            for sample in test:
                predictions.append(
                    AgentPrediction(sample.month, series.symbol, _to_vol(har_forecast(fit, sample.x)), _to_vol(sample.x[2]), None if sample.y is None else _to_vol(sample.y))
                )

    notes = [
        f"HAR (Corsi 2009) per name by OLS on daily rows: the mean Garman–Klass variance of the next {MONTH} sessions on the last session's, the last week's and the last month's. At each month end the regressors are read the session before the close.",
        f"Expanding walk-forward per name: forecasts start after {HAR_MIN_TRAIN_MONTHS} month ends, refit every {HAR_REFIT_MONTHS}, and a fit only uses rows whose outcome was complete before the forecast. Forecasts are floored at the calmest {MONTH}-session stretch in training.",
        "Garman–Klass uses each day's open, high, low and close, so it misses the overnight gap and runs below close-to-close vol. Forecast and outcome use the same measure.",
        "Recorded ATM implied vol joins the inputs once 252 sessions exist; recording started on 2026-09-25.",
    ]
    if short:
        notes.append(f"No forecast for {', '.join(short)}: fewer than {HAR_MIN_TRAIN_MONTHS + 1} usable months.")
    return AgentOutput("risk", RISK_VERSION, "vol", "1m", predictions, notes)


risk_vol_agent = Agent(name="risk", version=RISK_VERSION, target="vol", horizon="1m", run=run_risk_vol)
