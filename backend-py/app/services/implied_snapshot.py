import logging
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import BenchmarkPrice, ImpliedSnapshot, new_id, table_of
from app.services import yahoo
from app.services.iv_surface import mid_price
from app.timeutil import date_key, to_utc_date, utcnow

log = logging.getLogger("quantify")
# Front expiry at least this far out, so weeklies about to expire do not pin the series.
MIN_TENOR_DAYS = 20
IV_RANK_LOOKBACK = 252
# Below this the rank is just noise about which day recording started.
IV_RANK_MIN_SESSIONS = 20
# Recorded even when not held: the Events page defaults to it and it is the market's own straddle.
ALWAYS_RECORD = ["SPY"]


def atm_straddle(calls: list[dict[str, Any]], puts: list[dict[str, Any]], spot: float) -> dict[str, Any] | None:
    """Nearest strike to spot with a usable quote on both legs."""
    if not spot > 0:
        return None
    puts_by_strike = {put["strike"]: put for put in puts if put.get("strike") is not None}
    candidates = sorted(
        (call for call in calls if call.get("strike") is not None and call["strike"] in puts_by_strike),
        key=lambda call: abs(call["strike"] - spot),
    )
    for call in candidates:
        put = puts_by_strike[call["strike"]]
        call_mid = mid_price(call.get("bid"), call.get("ask"), call.get("lastPrice"))
        put_mid = mid_price(put.get("bid"), put.get("ask"), put.get("lastPrice"))
        if call_mid is None or put_mid is None:
            continue
        ivs = [iv for iv in (call.get("impliedVolatility"), put.get("impliedVolatility")) if isinstance(iv, (int, float)) and iv == iv and iv > 0 and iv != float("inf")]
        return {
            "strike": call["strike"],
            "callMid": call_mid,
            "putMid": put_mid,
            "impliedMove": (call_mid + put_mid) / spot,
            "atmIv": None if not ivs else sum(ivs) / len(ivs),
        }
    return None


def front_month_expiry(expiries: list[datetime], now: datetime) -> datetime | None:
    """First expiry at least MIN_TENOR_DAYS out, so consecutive days measure a similar tenor."""
    floor = now + timedelta(days=MIN_TENOR_DAYS)
    return next((expiry for expiry in sorted(expiries) if expiry >= floor), None)


def iv_rank(history: list[dict[str, float]], current: float) -> dict[str, float]:
    ivs = [row["iv"] for row in history]
    low = min(ivs)
    high = max(ivs)
    rank = (current - low) / (high - low) if high > low else 0.5
    percentile = len([iv for iv in ivs if iv <= current]) / len(ivs)
    return {"rank": rank, "percentile": percentile, "low": low, "high": high}


def _capture_one(db: Session, symbol: str, now: datetime) -> bool:
    head = yahoo.options(symbol)
    quote = head["quote"]
    try:
        spot = float(quote.get("regularMarketPrice"))
    except (TypeError, ValueError):
        return False
    if not spot > 0:
        return False
    expiry = front_month_expiry(head["expirationDates"], now)
    if expiry is None:
        return False
    chain = yahoo.options(symbol, expiry)
    slices = chain.get("options") or []
    chain_slice = slices[0] if slices else {}
    straddle = atm_straddle(chain_slice.get("calls") or [], chain_slice.get("puts") or [], spot)
    if straddle is None or straddle["atmIv"] is None:
        return False
    # The marks belong to the last US session, not the MYT morning the cron runs on.
    market_time = quote.get("regularMarketTime")
    session = to_utc_date(yahoo.from_epoch(market_time) if isinstance(market_time, (int, float)) else now)
    row = {
        "expiry": to_utc_date(expiry),
        "spot": spot,
        "strike": straddle["strike"],
        "atmIv": straddle["atmIv"],
        "straddleMove": straddle["impliedMove"],
    }
    statement = insert(table_of(ImpliedSnapshot)).values(id=new_id(), symbol=symbol, date=session, createdAt=utcnow(), **row)
    db.execute(statement.on_conflict_do_update(index_elements=["symbol", "date"], set_=row))
    db.commit()
    return True


def capture_implied_snapshots(db: Session, symbols: list[str]) -> dict[str, int]:
    """One ATM implied-vol row per US symbol. A thin chain on one name must not stop the daily sync."""
    now = utcnow()
    us = [symbol for symbol in dict.fromkeys([*ALWAYS_RECORD, *symbols]) if "." not in symbol]
    recorded = 0
    for symbol in us:
        try:
            if _capture_one(db, symbol, now):
                recorded += 1
        except Exception:
            db.rollback()
            log.exception("[iv-snapshot] capture failed %s", symbol)
    return {"attempted": len(us), "recorded": recorded}


def missed_sessions(calendar: list[str], recorded: list[str], since: str) -> list[str]:
    have = set(recorded)
    return [day for day in calendar if day >= since and day not in have]


def _us_sessions_since(db: Session, since: date) -> list[str]:
    rows = db.scalars(select(BenchmarkPrice.date).where(BenchmarkPrice.symbol == "^GSPC", BenchmarkPrice.date >= since).order_by(BenchmarkPrice.date)).all()
    return [date_key(day) for day in rows]


def get_iv_history(db: Session, symbol: str) -> dict[str, Any]:
    """IV rank from the rows this app recorded. None until enough sessions exist."""
    rows = db.scalars(select(ImpliedSnapshot).where(ImpliedSnapshot.symbol == symbol).order_by(ImpliedSnapshot.date.desc()).limit(IV_RANK_LOOKBACK)).all()
    if not rows:
        return {"history": None, "recorded": 0, "since": None, "missed": []}
    since = date_key(rows[-1].date)
    missed = missed_sessions(_us_sessions_since(db, rows[-1].date), [date_key(row.date) for row in rows], since)
    if len(rows) < IV_RANK_MIN_SESSIONS:
        return {"history": None, "recorded": len(rows), "since": since, "missed": missed}
    series = [{"iv": float(row.atm_iv)} for row in rows]
    current = series[0]["iv"]
    return {
        "recorded": len(rows),
        "since": since,
        "missed": missed,
        "history": {"n": len(rows), "since": since, "current": current, "expiry": date_key(rows[0].expiry), **iv_rank(series, current)},
    }
