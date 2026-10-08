"""Secondary five-session horizon helpers (G2). Decisions still use 1m only."""

from app.research.agents.types import SymbolSeries

FIVE_SESSIONS = 5


def next_n_return(series: SymbolSeries, index: int, sessions: int = FIVE_SESSIONS) -> float | None:
    """Total-return level change over the next `sessions` bars after `index`."""
    end = index + sessions
    if end >= len(series.level) or series.level[index] <= 0:
        return None
    value = series.level[end] / series.level[index] - 1
    return value if value == value else None


def dates_ahead(series: SymbolSeries, index: int, sessions: int = FIVE_SESSIONS) -> set[str]:
    """The next `sessions` stored dates after `index`, used to see which events fall inside a short horizon."""
    return set(series.dates[index + 1 : index + 1 + sessions])


def outcome_return(series: SymbolSeries, index: int, later_index: int | None, sessions: int | None) -> float | None:
    """Next-month total return when `sessions` is None, otherwise the next `sessions` bars."""
    if sessions:
        return next_n_return(series, index, sessions)
    if later_index is None or series.level[index] <= 0:
        return None
    value = series.level[later_index] / series.level[index] - 1
    return value if value == value else None


def next_n_max_drawdown(series: SymbolSeries, index: int, sessions: int = FIVE_SESSIONS) -> float | None:
    end = index + sessions
    if end >= len(series.level):
        return None
    peak = series.level[index]
    worst = 0.0
    for i in range(index, end + 1):
        value = series.level[i]
        if value > peak:
            peak = value
        if peak > 0:
            worst = min(worst, value / peak - 1)
    return worst