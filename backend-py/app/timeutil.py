"""Dates the way the Node API writes them: naive UTC in the database, `toISOString()` on the wire."""

from datetime import UTC, date, datetime, timedelta


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def iso(value: datetime) -> str:
    """JavaScript `Date.toISOString()`: milliseconds and a Z."""
    if value.tzinfo is not None:
        value = value.astimezone(UTC).replace(tzinfo=None)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"


def date_key(value: date | datetime) -> str:
    """YYYY-MM-DD of the UTC day."""
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(UTC)
        return value.strftime("%Y-%m-%d")
    return value.isoformat()


def parse_date(key: str) -> date:
    return date.fromisoformat(key)


def date_to_datetime(value: date) -> datetime:
    """A @db.Date column read through Prisma is midnight UTC."""
    return datetime(value.year, value.month, value.day)


def to_utc_date(value: datetime) -> date:
    if value.tzinfo is not None:
        value = value.astimezone(UTC)
    return date(value.year, value.month, value.day)


def ms(value: datetime) -> int:
    """Epoch milliseconds of a naive-UTC or aware datetime, like `Date.getTime()`."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return int(value.timestamp() * 1000)


def from_ms(value: float) -> datetime:
    return datetime(1970, 1, 1) + timedelta(milliseconds=value)


def day_ms(value: date) -> int:
    return ms(date_to_datetime(value))
