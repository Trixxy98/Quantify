import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Any

from app.config import settings
from app.errors import AppError
from app.services import yahoo
from app.services.black_scholes import OptionRight, implied_vol
from app.timeutil import date_key, iso, ms, utcnow

log = logging.getLogger("quantify")
MAX_EXPIRIES = 8
MIN_MONEYNESS = 0.7
MAX_MONEYNESS = 1.3
MIN_TTM_YEARS = 2 / 365
MIN_MID = 0.05
YEAR_MS = 365.25 * 24 * 60 * 60 * 1000


def _years_to(expiry: datetime, now: datetime) -> float:
    return (ms(expiry) - ms(now)) / YEAR_MS


def mid_price(bid: float | None, ask: float | None, last: float | None) -> float | None:
    if bid is not None and ask is not None and bid > 0 and ask > 0 and ask >= bid:
        return (bid + ask) / 2
    if last is not None and last > 0:
        return last
    return None


def _dividend_yield(quote: dict[str, Any]) -> float:
    raw = quote.get("trailingAnnualDividendYield")
    if raw is None:
        raw = quote.get("dividendYield")
    try:
        value = float(raw if raw is not None else 0)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(value) or value <= 0:
        return 0.0
    return value / 100 if value > 0.2 else value


def pick_expiries(dates: list[datetime], now: datetime) -> list[datetime]:
    future = sorted(day for day in dates if day > now + timedelta(days=2))
    if len(future) <= MAX_EXPIRIES:
        return future
    picked = future[:3]
    rest = future[3:]
    slots = MAX_EXPIRIES - 3
    for i in range(slots):
        # Math.round rounds halves up.
        picked.append(rest[math.floor((i + 1) * (len(rest) - 1) / slots + 0.5)])
    return list(dict.fromkeys(picked))


def _contract_mid_and_right(strike: float, spot: float, call: dict[str, Any], put: dict[str, Any]) -> tuple[float, OptionRight] | None:
    # OTM quotes are cleaner for inversion (less early-exercise premium).
    if strike >= spot:
        mid = mid_price(call.get("bid"), call.get("ask"), call.get("lastPrice"))
        return (mid, "call") if mid is not None else None
    mid = mid_price(put.get("bid"), put.get("ask"), put.get("lastPrice"))
    return (mid, "put") if mid is not None else None


def build_iv_surface(raw_symbol: str) -> dict[str, Any]:
    symbol = raw_symbol.strip().upper()
    if not symbol or "." in symbol:
        raise AppError(400, "UNSUPPORTED_MARKET", "IV surface uses US listed options (Yahoo). Try AAPL, MSFT, NVDA, SPY.")
    now = utcnow()
    try:
        head = yahoo.options(symbol)
    except Exception as err:
        log.exception("[iv] options lookup failed %s", symbol)
        raise AppError(502, "OPTIONS_UNAVAILABLE", "Could not load the options chain from Yahoo.") from err

    quote = head["quote"]
    spot = float(quote.get("regularMarketPrice") or "nan")
    if not math.isfinite(spot) or spot <= 0:
        raise AppError(502, "OPTIONS_UNAVAILABLE", "Underlying price is missing.")
    rate = settings.RISK_FREE_RATE
    q = _dividend_yield(quote)
    expiries = pick_expiries(head["expirationDates"], now)
    if not expiries:
        raise AppError(404, "NOT_FOUND", "No future option expiries for this symbol.")

    def fetch(expiry: datetime) -> dict[str, Any] | None:
        try:
            return yahoo.options(symbol, expiry)
        except Exception:
            log.exception("[iv] expiry fetch failed %s %s", symbol, expiry)
            return None

    with ThreadPoolExecutor(max_workers=3) as pool:
        chains = list(pool.map(fetch, expiries))

    points: list[dict[str, Any]] = []
    newton = 0
    bisection = 0
    for chain in chains:
        slices = (chain or {}).get("options") or []
        if not slices:
            continue
        chain_slice = slices[0]
        expiry_date = yahoo.from_epoch(chain_slice["expirationDate"])
        ttm = _years_to(expiry_date, now)
        if ttm < MIN_TTM_YEARS:
            continue
        puts = {put.get("strike"): put for put in chain_slice.get("puts") or []}
        for call in chain_slice.get("calls") or []:
            strike = call.get("strike")
            if strike is None:
                continue
            moneyness = strike / spot
            if moneyness < MIN_MONEYNESS or moneyness > MAX_MONEYNESS:
                continue
            put = puts.get(strike)
            if put is None:
                continue
            quoted = _contract_mid_and_right(strike, spot, call, put)
            if quoted is None or quoted[0] < MIN_MID:
                continue
            mid, right = quoted
            solved = implied_vol(mid, spot, strike, ttm, rate, q, right)
            if solved is None:
                continue
            if solved["method"] == "newton":
                newton += 1
            else:
                bisection += 1
            yahoo_raw = (call if right == "call" else put).get("impliedVolatility")
            points.append(
                {
                    "expiry": date_key(expiry_date),
                    "ttm": ttm,
                    "strike": strike,
                    "moneyness": moneyness,
                    "iv": solved["iv"],
                    "mid": mid,
                    "right": right,
                    "method": solved["method"],
                    "yahooIv": yahoo_raw if isinstance(yahoo_raw, (int, float)) and math.isfinite(yahoo_raw) else None,
                }
            )
    if len(points) < 8:
        raise AppError(422, "INSUFFICIENT_DATA", "Not enough liquid OTM quotes to build a surface. Try SPY or AAPL.")
    return {
        "symbol": symbol,
        "spot": spot,
        "rate": rate,
        "dividendYield": q,
        "asOf": iso(now),
        "points": points,
        "newtonCount": newton,
        "bisectionCount": bisection,
    }
