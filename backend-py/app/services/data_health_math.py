import math
from datetime import date, timedelta
from typing import Any, Literal

HealthStatus = Literal["ok", "warn", "bad"]
RANK: dict[str, int] = {"ok": 0, "warn": 1, "bad": 2}
# Splits smaller than this are indistinguishable from an ordinary day's move.
MIN_SPLIT_LOG_RATIO = math.log(1.05)
# IV gaps older than this many sessions are listed but no longer colour the row.
IV_RECENT_SESSIONS = 20
SHOWN_DATES = 5


def worst(statuses: list[str]) -> str:
    out = "ok"
    for status in statuses:
        if RANK[status] > RANK[out]:
            out = status
    return out


def status_rank(status: str) -> int:
    return RANK[status]


def weekdays_after(after: str, through: str) -> int:
    """Weekdays d with after < d <= through, both YYYY-MM-DD."""
    count = 0
    day = date.fromisoformat(after) + timedelta(days=1)
    end = date.fromisoformat(through)
    while day <= end:
        if day.weekday() < 5:
            count += 1
        day += timedelta(days=1)
    return count


def stale_sessions(last: str, calendar: list[str], expected: str) -> int:
    """Calendar sessions after the last bar, plus weekdays the calendar itself has not reached yet."""
    calendar_last = calendar[-1] if calendar else last
    behind = len([day for day in calendar if day > last])
    return behind + weekdays_after(calendar_last if calendar_last > last else last, expected)


def is_weekend(day: str) -> bool:
    return date.fromisoformat(day).weekday() >= 5


def traded_calendar(index_dates: list[str], series: list[set[str]]) -> dict[str, list[str]]:
    """
    Index dates minus those where at least two of the market's series were
    live and none has a bar: Yahoo sometimes prints an index bar on a holiday.
    """
    ranges = [(dates, min(dates), max(dates)) for dates in series if dates]
    calendar: list[str] = []
    dropped: list[str] = []
    for day in index_dates:
        live = [entry for entry in ranges if entry[1] <= day <= entry[2]]
        if len(live) >= 2 and all(day not in entry[0] for entry in live):
            dropped.append(day)
        else:
            calendar.append(day)
    return {"calendar": calendar, "dropped": dropped}


def missing_from_calendar(have: set[str], calendar: list[str], first: str, last: str) -> list[str]:
    return [day for day in calendar if first <= day <= last and day not in have]


def split_cliffs(bars: list[dict[str, Any]], splits: list[dict[str, Any]]) -> list[str]:
    """Split dates where stored closes still jump by the split ratio: the history before was never rebased."""
    cliffs = []
    for split in splits:
        try:
            ratio = math.log(split["denominator"] / split["numerator"])
        except (ValueError, ZeroDivisionError):
            continue
        if not math.isfinite(ratio) or abs(ratio) < MIN_SPLIT_LOG_RATIO:
            continue
        index = next((i for i, bar in enumerate(bars) if bar["date"] >= split["date"]), -1)
        if index <= 0:
            continue
        move = math.log(bars[index]["close"] / bars[index - 1]["close"])
        if abs(move - ratio) < abs(move):
            cliffs.append(split["date"])
    return cliffs


def staleness_status(sessions: int) -> str:
    if sessions <= 0:
        return "ok"
    return "warn" if sessions == 1 else "bad"


def gap_status(count: int) -> str:
    if count == 0:
        return "ok"
    return "warn" if count < 3 else "bad"


def _latest(dates: list[str]) -> list[str]:
    return list(reversed(dates[-SHOWN_DATES:]))


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def assess_price_series(
    bars: list[dict[str, Any]],
    calendar: list[str],
    expected: str,
    splits: list[dict[str, Any]] | None = None,
    ex_dates: list[str] | None = None,
    is_calendar: bool = False,
) -> dict[str, Any]:
    """Checks one stored daily series against its exchange calendar."""
    if not bars:
        return {
            "bars": 0,
            "firstDate": None,
            "lastDate": None,
            "staleSessions": None,
            "missingSessions": 0,
            "missingRecent": [],
            "weekendRows": 0,
            "splitCliffs": [],
            "dividendsWithoutBar": [],
            "status": "bad",
            "issues": ["No price bars stored. Run a sync."],
        }
    first = bars[0]["date"]
    last = bars[-1]["date"]
    have = {bar["date"] for bar in bars}
    statuses: list[str] = []
    issues: list[str] = []

    weekend_rows = [bar["date"] for bar in bars if is_weekend(bar["date"])]
    if weekend_rows:
        statuses.append("bad")
        issues.append(
            f"{_plural(len(weekend_rows), 'row')} dated on a weekend ({', '.join(_latest(weekend_rows))}). The source stamps bars in another time zone, so rows sit a day early and lookups on a date read the next session."
        )

    stale = weekdays_after(last, expected) if is_calendar else stale_sessions(last, calendar, expected)
    statuses.append(staleness_status(stale))
    if stale > 0:
        issues.append(f"{_plural(stale, 'session')} behind; last bar {last}, expected {expected}.")

    missing = [] if is_calendar else missing_from_calendar(have, calendar, first, last)
    statuses.append(gap_status(len(missing)))
    if missing:
        issues.append(f"{_plural(len(missing), 'exchange session')} with no bar, latest {missing[-1]}.")

    cliffs = split_cliffs(bars, splits or [])
    if cliffs:
        statuses.append("bad")
        issues.append(f"Closes still jump by the split ratio on {', '.join(cliffs)}; history before it was not rebased.")

    orphans = [day for day in (ex_dates or []) if first <= day <= last and day not in have]
    if orphans:
        statuses.append("warn")
        issues.append(f"{_plural(len(orphans), 'dividend')} go ex on a day with no bar ({', '.join(_latest(orphans))}); TWR books them on no snapshot.")

    return {
        "bars": len(bars),
        "firstDate": first,
        "lastDate": last,
        "staleSessions": stale,
        "missingSessions": len(missing),
        "missingRecent": _latest(missing),
        "weekendRows": len(weekend_rows),
        "splitCliffs": cliffs,
        "dividendsWithoutBar": orphans,
        "status": worst(statuses),
        "issues": issues,
    }


def assess_iv_recording(recorded: list[str], calendar: list[str], expected: str) -> dict[str, Any]:
    """Implied-vol rows against the US calendar from the first recording on. Only recent gaps colour the row."""
    ordered = sorted(recorded)
    if not ordered:
        return {"recorded": 0, "lastDate": None, "missed": 0, "missedRecent": [], "status": "warn", "issues": ["No implied vol recorded yet. The next sync starts it."]}
    first = ordered[0]
    last = ordered[-1]
    calendar_end = calendar[-1] if calendar else last
    missed = missing_from_calendar(set(ordered), calendar, first, calendar_end)
    recent_window = set(calendar[-IV_RECENT_SESSIONS:])
    missed_recent = len([day for day in missed if day in recent_window])
    statuses = [gap_status(missed_recent)]
    issues: list[str] = []
    if last < expected:
        statuses.append("warn")
        issues.append(f"No implied vol for the {expected} session yet; last recorded {last}.")
    if missed:
        issues.append(
            f"{_plural(len(missed), 'US session')} since {first} have no IV row ({', '.join(_latest(missed))}); they cannot be backfilled."
        )
    return {"recorded": len(ordered), "lastDate": last, "missed": len(missed), "missedRecent": _latest(missed), "status": worst(statuses), "issues": issues}
