from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

Market = Literal["US", "BURSA"]

# Close plus a quarter hour for Yahoo to publish the bar.
SESSIONS: dict[str, tuple[ZoneInfo, int]] = {
    "US": (ZoneInfo("America/New_York"), 16 * 60 + 15),
    "BURSA": (ZoneInfo("Asia/Kuala_Lumpur"), 17 * 60 + 15),
}


@dataclass(frozen=True)
class Session:
    close: datetime  # naive UTC
    date: str  # YYYY-MM-DD in the exchange's calendar


def latest_session(now: datetime, market: Market) -> Session:
    """
    The most recent weekday session of `market` whose bar should exist at `now`.
    Exchange holidays are treated as sessions: a sync after one finds no new
    bar and is recorded, so it does not repeat.
    """
    zone, close_minutes = SESSIONS[market]
    aware = now if now.tzinfo else now.replace(tzinfo=UTC)
    local = aware.astimezone(zone)
    day = local.date()
    minutes = local.hour * 60 + local.minute
    if minutes < close_minutes or day.weekday() >= 5:
        day -= timedelta(days=1)
        while day.weekday() >= 5:
            day -= timedelta(days=1)
    # Today's UTC offset is applied to the session day, as the Node API does; across a DST change the close is an hour off.
    now_utc = aware.astimezone(UTC).replace(tzinfo=None, second=0, microsecond=0)
    offset = local.replace(tzinfo=None, second=0, microsecond=0) - now_utc
    close = datetime(day.year, day.month, day.day) + timedelta(minutes=close_minutes) - offset
    return Session(close=close, date=day.isoformat())


def latest_us_session_close(now: datetime) -> datetime:
    return latest_session(now, "US").close
