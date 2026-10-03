import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.errors import AppError
from app.services import yahoo
from app.services.event_study import daily_closes
from app.services.events import load_macro, parse_date, resolve_event_dates
from app.services.implied_snapshot import IV_RANK_MIN_SESSIONS, atm_straddle, get_iv_history
from app.timeutil import date_key, ms, utcnow

log = logging.getLogger("quantify")
DAY_MS = 86_400_000
# E|X| for X ~ N(0, σ²). A straddle is priced on this, so realized moves are compared on the same scale.
EXPECTED_ABS_FACTOR = math.sqrt(2 / math.pi)


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 == 1 else (ordered[mid - 1] + ordered[mid]) / 2


def percentile_rank(sample: list[float], value: float) -> float | None:
    """Fraction of the sample at or below `value`."""
    if not sample or not math.isfinite(value):
        return None
    return len([item for item in sample if item <= value]) / len(sample)


def expiry_covering(expiries: list[str], event_date: str) -> str | None:
    """First listed expiry on or after the event. None when the chain ends first."""
    return next((expiry for expiry in sorted(expiries) if expiry >= event_date), None)


def expiry_before(expiries: list[str], event_date: str) -> str | None:
    """Last expiry strictly before the event; None when the event sits inside the front expiry."""
    return next((expiry for expiry in reversed(sorted(expiries)) if expiry < event_date), None)


def event_session_move(keys: list[str], closes: list[float], event_date: str, sessions: int = 1) -> dict[str, Any] | None:
    """
    Move from the close before the event to the close `sessions` trading days
    later, anchored on the first session on or after the event date.
    """
    anchor = next((i for i, key in enumerate(keys) if key >= event_date), -1)
    if anchor <= 0:
        return None
    end = anchor + sessions - 1
    if end >= len(keys):
        return None
    prev = closes[anchor - 1]
    nxt = closes[end]
    if not prev > 0 or not nxt > 0:
        return None
    return {"date": keys[anchor], "move": (nxt - prev) / prev}


def sessions_for(kind: str) -> int:
    # Earnings dates carry no time of day and most US names report after the close.
    return 2 if kind == "EARNINGS" else 1


def event_variance(iv_before: float, years_before: float, iv_after: float, years_after: float) -> float | None:
    """Total variance to the expiry after the event minus to the one before; None when the term structure makes it negative."""
    if not (iv_before > 0 and iv_after > 0 and years_after > years_before and years_before >= 0):
        return None
    diff = iv_after * iv_after * years_after - iv_before * iv_before * years_before
    return diff if diff > 0 else None


def implied_from_straddle(straddle: dict[str, Any], years: float) -> float | None:
    """Yahoo's IV when present, otherwise the IV the straddle price alone implies."""
    if straddle.get("atmIv") is not None and straddle["atmIv"] > 0:
        return straddle["atmIv"]
    if not years > 0:
        return None
    return straddle["impliedMove"] / (EXPECTED_ABS_FACTOR * math.sqrt(years))


def _next_macro(kind: str, today: str) -> str | None:
    data = load_macro()
    return next((day for day in sorted(data["fomc"] if kind == "FOMC" else data["cpi"]) if day >= today), None)


def _next_earnings(symbol: str, today: str) -> str | None:
    try:
        summary = yahoo.quote_summary(symbol, ["calendarEvents"])
    except Exception:
        return None
    # earningsCallDate is the last call that happened; earningsDate holds the next one (sometimes a range).
    earnings = (summary.get("calendarEvents") or {}).get("earnings") or {}
    candidates = sorted(
        key
        for raw in [*(earnings.get("earningsDate") or []), *(earnings.get("earningsCallDate") or [])]
        for parsed in [parse_date(raw)]
        if parsed is not None
        for key in [date_key(parsed)]
        if key >= today
    )
    return candidates[0] if candidates else None


def _live_straddle(symbol: str, event_date: str | None) -> dict[str, Any]:
    empty: dict[str, Any] = {"impliedMove": None, "atmIv": None, "expiry": None, "expiryBefore": None, "spot": None, "method": None, "chainNote": None}
    if "." in symbol:
        return {**empty, "chainNote": "Listed options are US names only, so there is no straddle to price."}
    if not event_date:
        return {**empty, "chainNote": "No upcoming date on the calendar, so there is no expiry to price."}
    try:
        head = yahoo.options(symbol)
    except Exception:
        log.exception("[premium] options lookup failed %s", symbol)
        return {**empty, "chainNote": "The options chain is unavailable right now."}

    now = utcnow()
    try:
        spot = float(head["quote"].get("regularMarketPrice"))
    except (TypeError, ValueError):
        spot = math.nan
    listed = sorted(({"key": date_key(day), "date": day} for day in head["expirationDates"]), key=lambda item: item["key"])
    keys = [item["key"] for item in listed]
    after_key = expiry_covering(keys, event_date)
    before_key = expiry_before(keys, event_date)
    after = next((item for item in listed if item["key"] == after_key), None)
    before = next((item for item in listed if item["key"] == before_key), None)
    if not math.isfinite(spot) or spot <= 0 or after is None:
        return {**empty, "spot": spot if math.isfinite(spot) else None, "chainNote": "Underlying price is missing." if after else "The next event sits beyond the listed expiries."}

    def quote_expiry(item: dict[str, Any]) -> dict[str, Any] | None:
        try:
            chain = yahoo.options(symbol, item["date"])
            slices = chain.get("options") or []
            chain_slice = slices[0] if slices else {}
            straddle = atm_straddle(chain_slice.get("calls") or [], chain_slice.get("puts") or [], spot)
            if straddle is None:
                return None
            years = (ms(item["date"]) - ms(now)) / (365.25 * DAY_MS)
            return {"straddle": straddle, "years": years, "iv": implied_from_straddle(straddle, years)}
        except Exception:
            log.exception("[premium] expiry fetch failed %s %s", symbol, item["key"])
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        after_future = pool.submit(quote_expiry, after)
        before_future = pool.submit(quote_expiry, before) if before else None
        quoted_after = after_future.result()
        quoted_before = before_future.result() if before_future else None
    if quoted_after is None:
        return {**empty, "spot": spot, "expiry": after["key"], "chainNote": "The at-the-money straddle on the covering expiry has no usable quote."}

    base = {"atmIv": quoted_after["straddle"]["atmIv"], "expiry": after["key"], "spot": spot}
    if quoted_before and quoted_before["iv"] is not None and quoted_after["iv"] is not None and before:
        variance = event_variance(quoted_before["iv"], quoted_before["years"], quoted_after["iv"], quoted_after["years"])
        if variance is not None:
            return {**base, "impliedMove": EXPECTED_ABS_FACTOR * math.sqrt(variance), "expiryBefore": before["key"], "method": "term-structure", "chainNote": None}
        return {
            **base,
            "impliedMove": quoted_after["straddle"]["impliedMove"],
            "expiryBefore": before["key"],
            "method": "straddle",
            "chainNote": f"The {before['key']} and {after['key']} expiries carry no extra variance for the event, so the straddle to {after['key']} is shown instead. It covers every session to expiry, not only the event.",
        }
    sessions = max(1, math.floor((ms(after["date"]) - ms(now)) / DAY_MS + 0.5))
    return {
        **base,
        "impliedMove": quoted_after["straddle"]["impliedMove"],
        "expiryBefore": before["key"] if before else None,
        "method": "straddle",
        "chainNote": (
            f"No expiry sits before the event, so the straddle to {after['key']} is shown. It covers {sessions} calendar days, not only the event session."
            if sessions > 3
            else None
        ),
    }


def get_variance_premium(db: Session, raw_symbol: str, kind: str, years: int) -> dict[str, Any]:
    symbol = raw_symbol.strip().upper()
    now = utcnow()
    today = date_key(now)
    from_ = now - timedelta(days=years * 365.25)
    from_key = date_key(from_)
    bars_from: datetime = from_ - timedelta(days=10)
    notes = [
        "Yahoo does not publish historical option prices, so this is today's straddle against past realized moves, not a backtest of past implied vol.",
        (
            "The realized move runs from the close before the earnings date to the close of the following session, so after-close reports are inside the window."
            if kind == "EARNINGS"
            else "The realized move is the event session versus the previous close."
        ),
        "The implied move is the extra variance between the expiry before the event and the one after it, turned into an expected absolute move; when no expiry sits before the event, the covering straddle is shown instead.",
    ]
    past: list[Any] = []
    try:
        past = resolve_event_dates(kind, [symbol], from_key, today)
    except AppError as err:
        notes.append(err.message)

    keys: list[str] = []
    closes: list[float] = []
    try:
        keys, closes = daily_closes(symbol, bars_from)
    except Exception:
        log.exception("[premium] chart fetch failed %s", symbol)
        notes.append(f"Could not load price history for {symbol}.")

    sessions = sessions_for(kind)
    moves = [move for event in past for move in [event_session_move(keys, closes, event["date"], sessions)] if move is not None and move["date"] < today]
    absolute = [abs(move["move"]) for move in moves]
    total = 0.0
    for value in absolute:
        total += value
    mean_abs = total / len(absolute) if absolute else None

    next_event = _next_earnings(symbol, today) if kind == "EARNINGS" else _next_macro(kind, today)
    quoted = _live_straddle(symbol, next_event)
    if quoted["chainNote"]:
        notes.append(quoted["chainNote"])

    stored = {"history": None, "recorded": 0, "since": None, "missed": []} if "." in symbol else get_iv_history(db, symbol)
    if stored["history"]:
        notes.append(f"IV rank uses {stored['history']['n']} front-month sessions this app recorded since {stored['history']['since']}. It is not Yahoo data.")
    elif stored["recorded"] > 0:
        notes.append(f"IV rank needs {IV_RANK_MIN_SESSIONS} recorded sessions; {stored['recorded']} so far since {stored['since']}. The daily sync adds one per US session.")
    elif "." not in symbol:
        notes.append(f"No IV history recorded for {symbol} yet. Add it to a portfolio and the daily sync starts building it.")
    if stored["missed"]:
        shown = ", ".join(stored["missed"][:5])
        more = f" and {len(stored['missed']) - 5} more" if len(stored["missed"]) > 5 else ""
        notes.append(
            f"{len(stored['missed'])} US sessions since {stored['since']} have no recording ({shown}{more}): no sync ran after that close, or the chain had no usable at-the-money quote. Yahoo serves only the current chain, so they stay empty."
        )

    gap = quoted["impliedMove"] - mean_abs if quoted["impliedMove"] is not None and mean_abs is not None else None
    return {
        "symbol": symbol,
        "eventType": kind,
        "years": years,
        "nextEvent": next_event,
        "expiry": quoted["expiry"],
        "expiryBefore": quoted["expiryBefore"],
        "spot": quoted["spot"],
        "atmIv": quoted["atmIv"],
        "impliedMove": quoted["impliedMove"],
        "method": quoted["method"],
        "moves": moves,
        "stats": {
            "n": len(moves),
            "medianAbs": median(absolute),
            "meanAbs": mean_abs,
            "gap": gap,
            "percentile": percentile_rank(absolute, quoted["impliedMove"]) if quoted["impliedMove"] is not None else None,
        },
        "ivHistory": stored["history"],
        "notes": notes,
    }
