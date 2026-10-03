"""
The four Yahoo endpoints the app uses, called through yfinance's data client
(it handles the consent cookie and crumb). These are the same raw endpoints
yahoo-finance2 wraps, so bars, timestamps and events match what the Node API
stored. yfinance's DataFrame helpers are not used: they re-index and repair
rows, which would change dates and prices.
"""

import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from yfinance.data import YfData

from app.timeutil import ms, utcnow

CHART_URL = "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"
OPTIONS_URL = "https://query2.finance.yahoo.com/v7/finance/options/{symbol}"
QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"
SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"
QUOTE_SUMMARY_URL = "https://query2.finance.yahoo.com/v10/finance/quoteSummary/{symbol}"

_client: YfData | None = None
_client_lock = threading.Lock()


class YahooError(RuntimeError):
    pass


def _data() -> YfData:
    global _client
    with _client_lock:
        if _client is None:
            _client = YfData()
        return _client


def _get(url: str, params: dict[str, Any]) -> dict[str, Any]:
    payload = _data().get_raw_json(url, params=params, timeout=30)
    if not isinstance(payload, dict):
        raise YahooError(f"unexpected Yahoo response from {url}")
    return payload


def from_epoch(seconds: float) -> datetime:
    """Yahoo epoch seconds as naive UTC, like `new Date(s * 1000)`."""
    return datetime.fromtimestamp(seconds, UTC).replace(tzinfo=None)


@dataclass
class Bar:
    date: datetime  # naive UTC timestamp of the bar
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    volume: float | None


@dataclass
class Chart:
    quotes: list[Bar]
    dividends: list[dict[str, Any]]  # {date, amount}
    splits: list[dict[str, Any]]  # {date, numerator, denominator}


def chart(symbol: str, from_: datetime) -> Chart:
    """Daily bars from `from_` to now with dividends and splits; bars without a close are dropped."""
    params = {
        "period1": int(ms(from_) // 1000),
        "period2": int(ms(utcnow()) // 1000),
        "interval": "1d",
        "events": "div|split",
        "includePrePost": "true",
    }
    payload = _get(CHART_URL.format(symbol=symbol), params)
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        error = (payload.get("chart") or {}).get("error") or {}
        raise YahooError(error.get("description") or f"no chart data for {symbol}")
    data = result[0]
    timestamps = data.get("timestamp") or []
    quote = ((data.get("indicators") or {}).get("quote") or [{}])[0]

    def column(name: str) -> list[Any]:
        values = quote.get(name) or []
        return values + [None] * (len(timestamps) - len(values))

    opens, highs, lows, closes, volumes = (column(name) for name in ("open", "high", "low", "close", "volume"))
    bars = [
        Bar(from_epoch(ts), opens[i], highs[i], lows[i], closes[i], volumes[i])
        for i, ts in enumerate(timestamps)
        if closes[i] is not None
    ]
    events = data.get("events") or {}
    dividends = [
        {"date": from_epoch(row["date"]), "amount": row.get("amount")}
        for row in (events.get("dividends") or {}).values()
        if row.get("date") is not None
    ]
    splits = [
        {"date": from_epoch(row["date"]), "numerator": row.get("numerator"), "denominator": row.get("denominator")}
        for row in (events.get("splits") or {}).values()
        if row.get("date") is not None
    ]
    dividends.sort(key=lambda row: row["date"])
    splits.sort(key=lambda row: row["date"])
    return Chart(bars, dividends, splits)


def options(symbol: str, expiry: datetime | None = None) -> dict[str, Any]:
    """Raw options chain: {quote, expirationDates (naive UTC), options: [{calls, puts, expirationDate}]}."""
    params: dict[str, Any] = {}
    if expiry is not None:
        params["date"] = int(ms(expiry) // 1000)
    payload = _get(OPTIONS_URL.format(symbol=symbol), params)
    result = (payload.get("optionChain") or {}).get("result") or []
    if not result:
        raise YahooError(f"no options for {symbol}")
    data = result[0]
    return {
        "quote": data.get("quote") or {},
        "expirationDates": [from_epoch(ts) for ts in data.get("expirationDates") or []],
        "options": data.get("options") or [],
    }


def quote(symbols: list[str]) -> list[dict[str, Any]]:
    payload = _get(QUOTE_URL, {"symbols": ",".join(symbols)})
    return list((payload.get("quoteResponse") or {}).get("result") or [])


def quote_summary(symbol: str, modules: list[str]) -> dict[str, Any]:
    """
    Raw quoteSummary modules with plain numbers (epoch seconds for dates).
    Yahoo answers 404 with a description for names without fundamentals
    ("No fundamentals data found"); that description is the error message.
    """
    response = _data().get(QUOTE_SUMMARY_URL.format(symbol=symbol), params={"modules": ",".join(modules), "formatted": "false"}, timeout=30)
    try:
        payload = response.json()
    except ValueError as err:
        raise YahooError(f"quoteSummary {symbol} returned {response.status_code}") from err
    summary = payload.get("quoteSummary") or {}
    result = summary.get("result") or []
    if not result:
        error = summary.get("error") or {}
        raise YahooError(error.get("description") or f"no quoteSummary for {symbol}")
    return result[0]


def search(query: str, quotes_count: int, news_count: int) -> dict[str, Any]:
    params = {"q": query, "quotesCount": quotes_count, "newsCount": news_count, "enableFuzzyQuery": "false"}
    return _get(SEARCH_URL, params)
