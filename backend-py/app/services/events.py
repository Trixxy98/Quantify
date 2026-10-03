import json
import logging
import re
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Literal, TypedDict

from app.errors import AppError
from app.services import yahoo
from app.timeutil import date_key

log = logging.getLogger("quantify")
EventType = Literal["FOMC", "CPI", "EARNINGS"]
MACRO_FILE = Path(__file__).resolve().parents[1] / "data" / "macroEvents.json"

# Yahoo lists filings, not press releases. If a filing sits within a few days of
# the one announcement date Yahoo does expose, every filing shifts by that lag.
MAX_CALIBRATION_LAG_DAYS = 4
QUARTER_TO_FILING_MIN_DAYS = 10
QUARTER_TO_FILING_MAX_DAYS = 100


class EventDate(TypedDict):
    symbol: str
    date: str
    label: str
    surprisePercent: float | None


def unwrap(value: Any) -> Any:
    """quoteSummary sometimes returns {raw, fmt} even with formatted=false."""
    return value.get("raw") if isinstance(value, dict) and "raw" in value else value


def parse_date(value: Any) -> datetime | None:
    """`new Date(value)` for an epoch-seconds number (already a Date in yahoo-finance2) or a date string."""
    value = unwrap(value)
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return yahoo.from_epoch(value)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo is None else parsed.astimezone(UTC).replace(tzinfo=None)
    return None


def _shift_days(key: str, days: int) -> str:
    return (date.fromisoformat(key) + timedelta(days=days)).isoformat()


def _day_gap(a: str, b: str) -> int:
    return (date.fromisoformat(a) - date.fromisoformat(b)).days


def load_macro() -> dict[str, Any]:
    return json.loads(MACRO_FILE.read_text())


def macro_dates(kind: str) -> list[str]:
    data = load_macro()
    return sorted(data["fomc"] if kind == "FOMC" else data["cpi"])


def _macro_label(kind: str, key: str) -> str:
    return f"FOMC decision {key}" if kind == "FOMC" else f"CPI release {key}"


def _no_filer_message(symbol: str) -> str:
    return f"{symbol} has no 10-Q / 10-K filings on Yahoo — earnings events only work for US filers. Try AAPL, MSFT or NVDA, or switch to Fed days."


def earnings_dates(symbol: str) -> list[EventDate]:
    """Announcement dates for a US filer, derived from Yahoo's 10-Q / 10-K list."""
    try:
        summary = yahoo.quote_summary(symbol, ["secFilings", "calendarEvents", "earningsHistory"])
    except Exception as err:
        # ETFs, indices and most Bursa names have no fundamentals endpoint at all.
        if re.search("fundamentals", str(err), re.IGNORECASE):
            raise AppError(422, "NO_EVENTS", _no_filer_message(symbol)) from err
        log.exception("[events] earnings lookup failed %s", symbol)
        raise AppError(502, "EVENTS_UNAVAILABLE", f"Could not load earnings filings for {symbol} from Yahoo.") from err

    filings = []
    for filing in (summary.get("secFilings") or {}).get("filings") or []:
        if filing.get("type") not in ("10-Q", "10-K"):
            continue
        parsed = parse_date(filing.get("epochDate")) or parse_date(filing.get("date"))
        if parsed:
            filings.append(date_key(parsed))
    filings.sort()
    if not filings:
        raise AppError(422, "NO_EVENTS", _no_filer_message(symbol))

    calls = ((summary.get("calendarEvents") or {}).get("earnings") or {}).get("earningsCallDate") or []
    last_call = parse_date(calls[0]) if calls else None
    lag = 0
    if last_call:
        call_key = date_key(last_call)
        for filing in filings:
            gap = _day_gap(call_key, filing)
            if abs(gap) <= MAX_CALIBRATION_LAG_DAYS:
                lag = gap
                break

    history = []
    for row in (summary.get("earningsHistory") or {}).get("history") or []:
        quarter = parse_date(row.get("quarter"))
        surprise = unwrap(row.get("surprisePercent"))
        if quarter and surprise is not None:
            history.append({"quarter": date_key(quarter), "surprisePercent": surprise})

    out: list[EventDate] = []
    for filing in filings:
        key = filing if lag == 0 else _shift_days(filing, lag)
        match = next((row for row in history if QUARTER_TO_FILING_MIN_DAYS <= _day_gap(key, row["quarter"]) <= QUARTER_TO_FILING_MAX_DAYS), None)
        out.append({"symbol": symbol, "date": key, "label": f"{symbol} earnings {key}", "surprisePercent": match["surprisePercent"] if match else None})
    return out


def resolve_event_dates(kind: str, symbols: list[str], from_key: str, to_key: str) -> list[EventDate]:
    if kind == "EARNINGS":
        filed = [event for symbol in symbols for event in earnings_dates(symbol) if from_key <= event["date"] <= to_key]
        if not filed:
            raise AppError(422, "NO_EVENTS", "No earnings filings inside this window. Try a longer history.")
        return sorted(filed, key=lambda event: event["date"])

    dates = [day for day in macro_dates(kind) if from_key <= day <= to_key]
    if not dates:
        if kind == "CPI":
            raise AppError(
                422,
                "NO_EVENTS",
                "No CPI release dates are loaded. BLS blocks automated fetches, so run `uv run python scripts/fetch_cpi_dates.py` in backend-py with FRED_API_KEY set. FOMC works out of the box.",
            )
        raise AppError(422, "NO_EVENTS", "No FOMC decisions inside this window.")
    events: list[EventDate] = [
        {"symbol": symbol, "date": day, "label": _macro_label(kind, day), "surprisePercent": None} for symbol in symbols for day in dates
    ]
    return sorted(events, key=lambda event: event["date"])
