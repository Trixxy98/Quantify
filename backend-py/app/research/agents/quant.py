"""Quant agent: FF5+Mom loadings × trailing factor premia → return rank and P(beat median)."""

import math
from dataclasses import dataclass

from app.research.agents.horizon import FIVE_SESSIONS, outcome_return
from app.research.agents.monthly import (
    fresh_month,
    latest_month_ends,
    month_distance,
    shift_month,
    symbol_months,
)
from app.research.agents.types import Agent, AgentInput, AgentOutput, AgentPrediction, SymbolSeries
from app.research.french import FACTOR_NAMES
from app.research.logistic import CollinearError as LogisticCollinearError
from app.research.logistic import logistic, predict_proba
from app.research.ols import CollinearError, ols
from app.research.walk_forward import expanding_folds

QUANT_VERSION = "quant-ff-v1"
QUANT_PROB_VERSION = "quant-ff-prob-v1"
QUANT_5D_VERSION = "quant-ff-5d-v1"
QUANT_PROB_5D_VERSION = "quant-ff-prob-5d-v1"
MIN_TRAIN_MONTHS = 60
REFIT_MONTHS = 12
MIN_CROSS_SECTION = 5
LOADING_WINDOW = 252
PREMIA_WINDOW = 252
MIN_OLS = 120
# OLS HAC lag on daily excess returns (same as the Factors page).
HAC_LAG = 5


@dataclass
class Row:
    symbol: str
    features: list[float]  # beta_k × trailing premia_k for each factor
    expected: float  # sum of features = implied next-month edge
    realized: float | None


@dataclass
class MonthPanel:
    month: str
    rows: list[Row]


def _date_index(dates: list[str]) -> dict[str, int]:
    return {day: i for i, day in enumerate(dates)}


def _factor_features(
    series: SymbolSeries,
    feature_idx: int,
    factors: dict[str, dict[str, float]],
) -> list[float] | None:
    """
    Rolling FF5+Mom loadings at the feature session, times trailing ~12m factor premia.
    Returns one value per factor (beta_k × premia_k), or None if the window is too thin.
    """
    if feature_idx < 1:
        return None
    # Premia: sum of daily factor returns ending on the feature day.
    premia = [0.0] * len(FACTOR_NAMES)
    premia_n = 0
    for back in range(PREMIA_WINDOW):
        key = series.dates[feature_idx - back] if feature_idx - back >= 0 else None
        if key is None:
            break
        row = factors.get(key)
        if row is None or any(name not in row for name in FACTOR_NAMES):
            continue
        for k, name in enumerate(FACTOR_NAMES):
            premia[k] += row[name]
        premia_n += 1
    if premia_n < MIN_OLS:
        return None

    start = max(1, feature_idx - LOADING_WINDOW + 1)
    y: list[float] = []
    x: list[list[float]] = []
    for i in range(start, feature_idx + 1):
        prev = series.level[i - 1]
        if prev <= 0:
            continue
        ret = series.level[i] / prev - 1
        row = factors.get(series.dates[i])
        if row is None:
            continue
        rf = row.get("RF")
        regs = [row.get(name) for name in FACTOR_NAMES]
        if rf is None or any(value is None for value in regs):
            continue
        y.append(ret - float(rf))
        x.append([float(value) for value in regs if value is not None])
    if len(y) < MIN_OLS:
        return None
    try:
        fit = ols(y, x, HAC_LAG)
    except (CollinearError, ValueError):
        return None
    # Skip intercept: the signal is loadings × premia.
    betas = fit["beta"][1:]
    features = [betas[k] * premia[k] for k in range(len(FACTOR_NAMES))]
    return features if all(math.isfinite(value) for value in features) else None


def _build_panels(data: AgentInput, sessions: int | None = None) -> list[MonthPanel]:
    factors = data.factors or {}
    if not factors:
        return []
    us = [series for series in data.series if series.market == "US"]
    months = [symbol_months(series) for series in us]
    latest = latest_month_ends(months)
    as_of_month = data.as_of[:7]
    current = latest.get(as_of_month)
    if current is None or current < data.as_of:
        latest[as_of_month] = data.as_of

    panels: list[MonthPanel] = []
    for month in sorted(latest):
        rows: list[Row] = []
        for s, series in enumerate(us):
            now = fresh_month(months[s], month, latest)
            if now is None:
                continue
            features = _factor_features(series, now.feature, factors)
            if features is None:
                continue
            nxt = fresh_month(months[s], shift_month(month, 1), latest)
            realized = outcome_return(series, now.index, nxt.index if nxt else None, sessions)
            rows.append(Row(series.symbol, features, sum(features), realized))
        if len(rows) >= MIN_CROSS_SECTION:
            panels.append(MonthPanel(month, rows))
    return panels


def _trainable(panels: list[MonthPanel], first_test: str) -> list[MonthPanel]:
    return [panel for panel in panels if month_distance(panel.month, first_test) >= 2]


def run_quant_return(data: AgentInput, sessions: int | None = None) -> AgentOutput:
    panels = _build_panels(data, sessions)
    predictions: list[AgentPrediction] = []
    for fold in expanding_folds(len(panels), MIN_TRAIN_MONTHS, REFIT_MONTHS):
        test = panels[fold.test_start : fold.test_end]
        # No fitted parameters for the rank signal: loadings × premia is the forecast.
        # The walk-forward still starts after MIN_TRAIN_MONTHS so the live record is comparable to Technical.
        for panel in test:
            for row in panel.rows:
                predictions.append(AgentPrediction(panel.month, row.symbol, row.expected, 0.0, row.realized))

    notes = [
        f"Implied edge = rolling {LOADING_WINDOW}-day FF5+Mom loadings × trailing {PREMIA_WINDOW}-day factor premia, read one session before the month-end close. The outcome is the next {sessions} sessions."
        if sessions
        else f"Implied edge = rolling {LOADING_WINDOW}-day FF5+Mom loadings × trailing {PREMIA_WINDOW}-day factor premia, read one session before the month-end close.",
        "Baseline is zero (no expected edge). Scored as a cross-sectional return-rank IC against that baseline.",
        f"Expanding walk-forward: first forecast after {MIN_TRAIN_MONTHS} month ends, then every {REFIT_MONTHS} months (same calendar as Technical).",
        "SPY is included when it is in the universe (index view).",
    ]
    if not (data.factors or {}):
        notes.append("No Ken French factor rows on the input; the orchestrator must load FactorReturn into AgentInput.factors.")
    elif not predictions:
        notes.append(f"Need {MIN_TRAIN_MONTHS + 1} months with at least {MIN_CROSS_SECTION} names and overlapping factor data before the first forecast.")
    version = QUANT_5D_VERSION if sessions else QUANT_VERSION
    horizon = "5d" if sessions else "1m"
    return AgentOutput("quant", version, "returnScore", horizon, predictions, notes)


def run_quant_prob(data: AgentInput, sessions: int | None = None) -> AgentOutput:
    panels = _build_panels(data, sessions)
    predictions: list[AgentPrediction] = []
    for fold in expanding_folds(len(panels), MIN_TRAIN_MONTHS, REFIT_MONTHS):
        test = panels[fold.test_start : fold.test_end]
        train = _trainable(panels[: fold.train_end], test[0].month)
        x: list[list[float]] = []
        y: list[int] = []
        for panel in train:
            known = [(row, value) for row in panel.rows if (value := row.realized) is not None]
            if len(known) < MIN_CROSS_SECTION:
                continue
            realized_values = [value for _, value in known]
            median = sorted(realized_values)[len(realized_values) // 2]
            for row, value in known:
                x.append(row.features)
                y.append(1 if value > median else 0)
        if len(y) <= len(FACTOR_NAMES) + 1 or len(set(y)) < 2:
            continue
        try:
            fit = logistic(y, x)
        except (LogisticCollinearError, ValueError):
            continue
        for panel in test:
            known = [(row, value) for row in panel.rows if (value := row.realized) is not None]
            realized_values = [value for _, value in known]
            cut: float | None = sorted(realized_values)[len(realized_values) // 2] if len(known) >= MIN_CROSS_SECTION else None
            probs = predict_proba(fit["beta"], [row.features for row in panel.rows])
            for i, row in enumerate(panel.rows):
                realized_flag = None if row.realized is None or cut is None else (1.0 if row.realized > cut else 0.0)
                predictions.append(AgentPrediction(panel.month, row.symbol, probs[i], 0.5, realized_flag))

    notes = [
        "Logistic regression on the same beta×premia features, predicting whether next month's return beats that month's cross-sectional median.",
        "Baseline is 50%. Realized is 1/0 for beat/miss when the outcome month is complete.",
        f"Expanding walk-forward: at least {MIN_TRAIN_MONTHS} months of training, refit every {REFIT_MONTHS}.",
    ]
    if not predictions:
        notes.append("Not enough factor-aligned history to fit the probability model yet.")
    version = QUANT_PROB_5D_VERSION if sessions else QUANT_PROB_VERSION
    horizon = "5d" if sessions else "1m"
    return AgentOutput("quant", version, "probBeatMedian", horizon, predictions, notes)


def run_quant_return_5d(data: AgentInput) -> AgentOutput:
    return run_quant_return(data, FIVE_SESSIONS)


def run_quant_prob_5d(data: AgentInput) -> AgentOutput:
    return run_quant_prob(data, FIVE_SESSIONS)


quant_agent = Agent(name="quant", version=QUANT_VERSION, target="returnScore", horizon="1m", run=run_quant_return)
quant_prob_agent = Agent(name="quant", version=QUANT_PROB_VERSION, target="probBeatMedian", horizon="1m", run=run_quant_prob)
quant_5d_agent = Agent(name="quant", version=QUANT_5D_VERSION, target="returnScore", horizon="5d", run=run_quant_return_5d)
quant_prob_5d_agent = Agent(name="quant", version=QUANT_PROB_5D_VERSION, target="probBeatMedian", horizon="5d", run=run_quant_prob_5d)