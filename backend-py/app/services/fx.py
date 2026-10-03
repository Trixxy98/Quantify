from bisect import bisect_right
from collections.abc import Sequence
from datetime import UTC, date, datetime
from typing import TypedDict
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Currency, ExchangeRate
from app.timeutil import day_ms

LONDON = ZoneInfo("Europe/London")


class SeriesPoint(TypedDict):
    date: int  # epoch ms of the UTC-midnight date
    close: float


def fx_bar_date(timestamp: datetime) -> datetime:
    """
    Yahoo stamps daily FX bars at London midnight, which is 23:00 UTC the day
    before during British Summer Time. Dating them by the UTC day would file
    each rate one day early, so they are dated by the London day instead.
    """
    aware = timestamp if timestamp.tzinfo else timestamp.replace(tzinfo=UTC)
    local = aware.astimezone(LONDON)
    return datetime(local.year, local.month, local.day)


def is_weekend_date(value: date | datetime) -> bool:
    return value.weekday() >= 5


def latest_at_or_before(series: Sequence[SeriesPoint], time: int) -> float | None:
    """Close of the last point dated at or before `time`. Every caller passes series in ascending date order."""
    index = bisect_right(series, time, key=lambda point: point["date"])
    return series[index - 1]["close"] if index > 0 else None


def load_usd_myr_series(db: Session) -> list[SeriesPoint]:
    rows = db.execute(
        select(ExchangeRate.date, ExchangeRate.rate)
        .where(ExchangeRate.from_ == Currency.USD, ExchangeRate.to == Currency.MYR)
        .order_by(ExchangeRate.date)
    ).all()
    return [{"date": day_ms(row.date), "close": float(row.rate)} for row in rows]


def to_base(value: float, from_: str, base: str, series: Sequence[SeriesPoint], time: int) -> float | None:
    if from_ == base:
        return value
    rate = latest_at_or_before(series, time)
    if rate is None:
        return None
    return value * rate if from_ == Currency.USD else value / rate
