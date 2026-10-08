"""Event agent: past abnormal returns / moves for event types scheduled in the next month."""

import math
from dataclasses import dataclass
from datetime import date
from typing import Any

from app.research.agents.horizon import FIVE_SESSIONS, dates_ahead, outcome_return
from app.research.agents.monthly import (
    fresh_month,
    latest_month_ends,
    mean,
    shift_month,
    symbol_months,
)
from app.research.agents.types import Agent, AgentInput, AgentOutput, AgentPrediction, SymbolSeries
from app.research.walk_forward import expanding_folds

EVENT_VERSION = "event-hist-v1"
EVENT_VOL_VERSION = "event-vol-v1"
EVENT_5D_VERSION = "event-hist-5d-v1"
EVENT_VOL_5D_VERSION = "event-vol-5d-v1"
MIN_TRAIN_MONTHS = 60
REFIT_MONTHS = 12
MIN_CROSS_SECTION = 5
MIN_PAST_EVENTS = 3
# Trailing window used as the "normal" daily move for vol uplift.
TRAIL_SESSIONS = 22
MARKET_PROXY = ("SPY", "^GSPC")


@dataclass
class Row:
    symbol: str
    mean_ar: float
    mean_move: float
    realized: float | None
    realized_uplift: float | None


@dataclass
class MonthPanel:
    month: str
    rows: list[Row]


def _index_on_or_before(dates: list[str], day: str) -> int | None:
    lo, hi = 0, len(dates)
    while lo < hi:
        mid = (lo + hi) // 2
        if dates[mid] <= day:
            lo = mid + 1
        else:
            hi = mid
    return lo - 1 if lo > 0 else None


def _daily_return(series: SymbolSeries, i: int) -> float | None:
    if i < 1 or series.level[i - 1] <= 0:
        return None
    value = series.level[i] / series.level[i - 1] - 1
    return value if math.isfinite(value) else None


def _market_series(data: AgentInput) -> SymbolSeries | None:
    by_symbol = {series.symbol: series for series in data.series}
    for symbol in MARKET_PROXY:
        if symbol in by_symbol:
            return by_symbol[symbol]
    return None


def _event_ar(series: SymbolSeries, market: SymbolSeries | None, day: str) -> float | None:
    i = _index_on_or_before(series.dates, day)
    if i is None:
        return None
    # Only count the session on/just before the event if it is close to the calendar date.
    if abs((date.fromisoformat(series.dates[i]) - date.fromisoformat(day)).days) > 3:
        return None
    stock = _daily_return(series, i)
    if stock is None:
        return None
    if market is None:
        return stock
    j = _index_on_or_before(market.dates, series.dates[i])
    if j is None:
        return stock
    bench = _daily_return(market, j)
    return stock - bench if bench is not None else stock


def _normalize_events(raw: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    out = []
    for row in raw or []:
        day = row.get("date")
        kind = row.get("type")
        if not isinstance(day, str) or not isinstance(kind, str):
            continue
        symbol = row.get("symbol")
        out.append({"date": day, "type": kind.upper(), "symbol": symbol.upper() if isinstance(symbol, str) and symbol else None})
    return out


def _types_ahead(events: list[dict[str, Any]], dates: set[str], symbol: str) -> set[str]:
    types: set[str] = set()
    for event in events:
        if event["date"] not in dates:
            continue
        if event["symbol"] is None or event["symbol"] == symbol:
            types.add(event["type"])
    return types


def _types_in_month(events: list[dict[str, Any]], month: str, symbol: str) -> set[str]:
    types: set[str] = set()
    for event in events:
        if event["date"][:7] != month:
            continue
        if event["symbol"] is None or event["symbol"] == symbol:
            types.add(event["type"])
    return types


def _past_stats(
    series: SymbolSeries,
    market: SymbolSeries | None,
    events: list[dict[str, Any]],
    types: set[str],
    before: str,
    symbol: str,
) -> tuple[float, float] | None:
    ars: list[float] = []
    moves: list[float] = []
    for event in events:
        if event["type"] not in types:
            continue
        if event["date"] >= before:
            continue
        if event["symbol"] is not None and event["symbol"] != symbol:
            continue
        ar = _event_ar(series, market, event["date"])
        if ar is None:
            continue
        ars.append(ar)
        moves.append(abs(ar))
    if len(ars) < MIN_PAST_EVENTS:
        return None
    return mean(ars), mean(moves)


def _vol_uplift(series: SymbolSeries, start: int, end: int, feature: int) -> float | None:
    """Next-month mean |daily return| over trailing mean |daily return|, minus 1."""
    if end <= start or feature < TRAIL_SESSIONS:
        return None
    future = [_daily_return(series, i) for i in range(start + 1, end + 1)]
    trail = [_daily_return(series, i) for i in range(feature - TRAIL_SESSIONS + 1, feature + 1)]
    future_abs = [abs(value) for value in future if value is not None]
    trail_abs = [abs(value) for value in trail if value is not None]
    if len(future_abs) < 5 or len(trail_abs) < 10:
        return None
    base = mean(trail_abs)
    if not base > 0:
        return None
    return mean(future_abs) / base - 1


def _build_panels(data: AgentInput, sessions: int | None = None) -> list[MonthPanel]:
    events = _normalize_events(data.events)
    if not events:
        return []
    market = _market_series(data)
    us = [series for series in data.series if series.market == "US"]
    months = [symbol_months(series) for series in us]
    latest = latest_month_ends(months)
    as_of_month = data.as_of[:7]
    current = latest.get(as_of_month)
    if current is None or current < data.as_of:
        latest[as_of_month] = data.as_of

    panels: list[MonthPanel] = []
    for month in sorted(latest):
        nxt_month = shift_month(month, 1)
        rows: list[Row] = []
        for s, series in enumerate(us):
            now = fresh_month(months[s], month, latest)
            if now is None:
                continue
            if sessions:
                types = _types_ahead(events, dates_ahead(series, now.index, sessions), series.symbol)
            else:
                types = _types_in_month(events, nxt_month, series.symbol)
            if not types:
                continue
            stats = _past_stats(series, market, events, types, now.date, series.symbol)
            if stats is None:
                continue
            mean_ar, mean_move = stats
            nxt = fresh_month(months[s], nxt_month, latest)
            realized = outcome_return(series, now.index, nxt.index if nxt else None, sessions)
            end = now.index + sessions if sessions else (nxt.index if nxt else None)
            uplift = _vol_uplift(series, now.index, end, now.feature) if end is not None and end < len(series.level) else None
            rows.append(Row(series.symbol, mean_ar, mean_move, realized, uplift))
        if len(rows) >= MIN_CROSS_SECTION:
            panels.append(MonthPanel(month, rows))
    return panels


def _empty(agent: str, version: str, target: str, horizon: str, notes: list[str]) -> AgentOutput:
    return AgentOutput(agent, version, target, horizon, [], notes)


def run_event_return(data: AgentInput, sessions: int | None = None) -> AgentOutput:
    base_notes = [
        "For each name, forecast = mean event-day return (minus SPY/^GSPC when present) on past events whose types are scheduled in the next "
        + (f"{sessions} sessions." if sessions else "month."),
        "Baseline is zero. Only names with a scheduled FOMC, CPI or earnings date in the next month and enough past events are scored.",
        f"Expanding walk-forward: first forecast after {MIN_TRAIN_MONTHS} month ends, refit every {REFIT_MONTHS}.",
    ]
    version = EVENT_5D_VERSION if sessions else EVENT_VERSION
    horizon = "5d" if sessions else "1m"
    panels = _build_panels(data, sessions)
    if not (data.events or []):
        return _empty("event", version, "returnScore", horizon, [*base_notes, "No events on AgentInput; the orchestrator must load the macro calendar and earnings dates."])

    predictions: list[AgentPrediction] = []
    for fold in expanding_folds(len(panels), MIN_TRAIN_MONTHS, REFIT_MONTHS):
        for panel in panels[fold.test_start : fold.test_end]:
            for row in panel.rows:
                predictions.append(AgentPrediction(panel.month, row.symbol, row.mean_ar, 0.0, row.realized))

    notes = list(base_notes)
    if not predictions:
        notes.append(f"Need {MIN_TRAIN_MONTHS + 1} months with scheduled events and at least {MIN_PAST_EVENTS} past matches per name.")
    return AgentOutput("event", version, "returnScore", horizon, predictions, notes)


def run_event_vol(data: AgentInput, sessions: int | None = None) -> AgentOutput:
    base_notes = [
        "Vol uplift forecast = mean absolute event-day (abnormal) move on the same past events as the return agent.",
        "Realized uplift = next month's mean |daily return| ÷ trailing 22-session mean |daily return| − 1. Baseline is zero.",
        f"Expanding walk-forward: first forecast after {MIN_TRAIN_MONTHS} month ends, refit every {REFIT_MONTHS}.",
    ]
    version = EVENT_VOL_5D_VERSION if sessions else EVENT_VOL_VERSION
    horizon = "5d" if sessions else "1m"
    panels = _build_panels(data, sessions)
    if not (data.events or []):
        return _empty("event", version, "volUplift", horizon, [*base_notes, "No events on AgentInput; the orchestrator must load the calendar first."])

    predictions: list[AgentPrediction] = []
    for fold in expanding_folds(len(panels), MIN_TRAIN_MONTHS, REFIT_MONTHS):
        for panel in panels[fold.test_start : fold.test_end]:
            for row in panel.rows:
                predictions.append(AgentPrediction(panel.month, row.symbol, row.mean_move, 0.0, row.realized_uplift))

    notes = list(base_notes)
    if not predictions:
        notes.append("Not enough scheduled-event history for a vol-uplift forecast yet.")
    return AgentOutput("event", version, "volUplift", horizon, predictions, notes)


def run_event_return_5d(data: AgentInput) -> AgentOutput:
    return run_event_return(data, FIVE_SESSIONS)


def run_event_vol_5d(data: AgentInput) -> AgentOutput:
    return run_event_vol(data, FIVE_SESSIONS)


event_agent = Agent(name="event", version=EVENT_VERSION, target="returnScore", horizon="1m", run=run_event_return)
event_vol_agent = Agent(name="event", version=EVENT_VOL_VERSION, target="volUplift", horizon="1m", run=run_event_vol)
event_5d_agent = Agent(name="event", version=EVENT_5D_VERSION, target="returnScore", horizon="5d", run=run_event_return_5d)
event_vol_5d_agent = Agent(name="event", version=EVENT_VOL_5D_VERSION, target="volUplift", horizon="5d", run=run_event_vol_5d)