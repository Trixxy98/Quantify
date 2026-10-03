import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from app.research.agents.types import SymbolSeries
from app.research.momentum import month_ends

# A month end more than this many days before the month's latest one is a stale or missing bar.
FRESH_DAYS = 4


@dataclass(frozen=True)
class SymbolMonth:
    """`feature` is the session before the month end: inputs are read before the close the forecast is issued at."""

    month: str
    date: str
    index: int
    feature: int


def symbol_months(series: SymbolSeries) -> dict[str, SymbolMonth]:
    out: dict[str, SymbolMonth] = {}
    for end in month_ends(series.dates):
        if end.index < 1:
            continue
        out[end.month] = SymbolMonth(end.month, end.date, end.index, end.index - 1)
    return out


def shift_month(month: str, by: int) -> str:
    year, mon = (int(part) for part in month.split("-"))
    total = year * 12 + (mon - 1) + by
    return f"{total // 12}-{total % 12 + 1:02d}"


def month_distance(start: str, end: str) -> int:
    fy, fm = (int(part) for part in start.split("-"))
    ty, tm = (int(part) for part in end.split("-"))
    return (ty - fy) * 12 + (tm - fm)


def latest_month_ends(all_months: list[dict[str, SymbolMonth]]) -> dict[str, str]:
    """Latest month-end date per month across all symbols."""
    out: dict[str, str] = {}
    for months in all_months:
        for month, end in months.items():
            current = out.get(month)
            if current is None or end.date > current:
                out[month] = end.date
    return out


def is_fresh(day: str, reference: str) -> bool:
    return (date.fromisoformat(reference) - date.fromisoformat(day)).days <= FRESH_DAYS


def fresh_month(months: dict[str, SymbolMonth], month: str, latest: dict[str, str]) -> SymbolMonth | None:
    """The month end for `month`, unless it is a stale bar compared with the other names."""
    end = months.get(month)
    reference = latest.get(month)
    if end is None or reference is None or not is_fresh(end.date, reference):
        return None
    return end


def mean(values: Sequence[float]) -> float:
    if len(values) == 0:
        return math.nan
    total = 0.0
    for value in values:
        total += value
    return total / len(values)
