import calendar
from datetime import date
from typing import Literal

from app.timeutil import utcnow

Range = Literal["1M", "3M", "6M", "1Y", "YTD", "ALL"]
RANGES: tuple[str, ...] = ("1M", "3M", "6M", "1Y", "YTD", "ALL")


def _add_months(value: date, months: int) -> date:
    raw = value.month - 1 + months
    year = value.year + raw // 12
    month = raw % 12 + 1
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(value.day, last))


def resolve_range_start(range_: str) -> date | None:
    today = utcnow().date()
    match range_:
        case "1M":
            return _add_months(today, -1)
        case "3M":
            return _add_months(today, -3)
        case "6M":
            return _add_months(today, -6)
        case "1Y":
            # Date.setUTCFullYear on 29 Feb rolls to 1 Mar.
            try:
                return today.replace(year=today.year - 1)
            except ValueError:
                return date(today.year - 1, 3, 1)
        case "YTD":
            return date(today.year, 1, 1)
        case _:
            return None
