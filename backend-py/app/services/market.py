import logging
import re
import time
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import (
    Base,
    BenchmarkPrice,
    Currency,
    DailyPrice,
    Dividend,
    ExchangeRate,
    Holding,
    StockSplit,
    Transaction,
    new_id,
    table_of,
)
from app.rows import currency_from_symbol
from app.services import yahoo
from app.services.corporate_actions import is_rebased
from app.services.fx import fx_bar_date, is_weekend_date
from app.timeutil import date_key, iso, to_utc_date, utcnow

log = logging.getLogger("quantify")

# ^SP500TR is the total-return S&P 500: the dashboard compares it against a
# dividend-inclusive portfolio. ^GSPC stays for price-vs-price work.
BENCHMARK_SYMBOLS = ["^KLSE", "^GSPC", "^SP500TR"]
USD_MYR_SYMBOL = "MYR=X"
# Corporate actions must be complete however short the price window, so events are always pulled from here.
HISTORY_START = datetime(2000, 1, 1)
_CHUNK = 2000


def _insert_ignore(db: Session, model: type[Base], rows: list[dict[str, Any]]) -> None:
    """Prisma `createMany({skipDuplicates: true})`."""
    table = table_of(model)
    for start in range(0, len(rows), _CHUNK):
        chunk = rows[start : start + _CHUNK]
        if chunk:
            db.execute(insert(table).values(chunk).on_conflict_do_nothing())


def _has_rebased(db: Session, symbol: str, bars: list[yahoo.Bar]) -> bool:
    """Compares the oldest stored bar against what Yahoo reports for that same day."""
    stored = db.scalars(select(DailyPrice).where(DailyPrice.symbol == symbol).order_by(DailyPrice.date).limit(1)).first()
    if stored is None:
        return False
    match = next((bar for bar in bars if to_utc_date(bar.date) == stored.date), None)
    if match is None or not match.close:
        return False
    return is_rebased(float(stored.close), match.close)


def _save_corporate_actions(db: Session, symbol: str, chart: yahoo.Chart) -> dict[str, int]:
    currency = currency_from_symbol(symbol).value
    splits = [
        {"id": new_id(), "symbol": symbol, "date": to_utc_date(row["date"]), "numerator": round(row["numerator"]), "denominator": round(row["denominator"])}
        for row in chart.splits
        if row.get("date") and row.get("numerator") and row.get("denominator")
    ]
    dividends = [
        {"id": new_id(), "symbol": symbol, "exDate": to_utc_date(row["date"]), "amount": row["amount"], "currency": currency}
        for row in chart.dividends
        if row.get("date") and row.get("amount") is not None and row["amount"] > 0
    ]
    db.execute(delete(StockSplit).where(StockSplit.symbol == symbol))
    _insert_ignore(db, StockSplit, splits)
    db.execute(delete(Dividend).where(Dividend.symbol == symbol))
    _insert_ignore(db, Dividend, dividends)
    return {"splits": len(splits), "dividends": len(dividends)}


def get_tracked_symbols(db: Session) -> list[str]:
    holdings = db.scalars(select(Holding.symbol).distinct()).all()
    trades = db.scalars(select(Transaction.symbol).distinct()).all()
    return sorted(set(holdings) | set(trades))


def sync_daily_prices(db: Session, symbol: str, from_: datetime) -> None:
    # One call covers everything: events need full history, prices only the
    # window unless the series turns out to have been rebased.
    chart = yahoo.chart(symbol, HISTORY_START)
    currency = currency_from_symbol(symbol).value
    try:
        _save_corporate_actions(db, symbol, chart)
        rebased = _has_rebased(db, symbol, chart.quotes)
        from_date = HISTORY_START.date() if rebased else to_utc_date(from_)
        if rebased:
            log.warning("[sync] %s was restated by Yahoo, rewriting full price history", symbol)
        rows = [
            {
                "id": new_id(),
                "symbol": symbol,
                "date": to_utc_date(bar.date),
                "open": bar.open if bar.open is not None else bar.close,
                "high": bar.high if bar.high is not None else bar.close,
                "low": bar.low if bar.low is not None else bar.close,
                "close": bar.close,
                "volume": round(bar.volume or 0),
                "currency": currency,
            }
            for bar in chart.quotes
            if to_utc_date(bar.date) >= from_date
        ]
        db.execute(delete(DailyPrice).where(DailyPrice.symbol == symbol, DailyPrice.date >= from_date))
        _insert_ignore(db, DailyPrice, rows)
        db.commit()
    except Exception:
        db.rollback()
        raise


def sync_benchmark_prices(db: Session, symbol: str, from_: datetime) -> None:
    # A benchmark added later (^SP500TR) starts empty; a short window would leave it too short to be picked.
    existing = db.scalar(select(BenchmarkPrice.id).where(BenchmarkPrice.symbol == symbol).limit(1))
    start = HISTORY_START if existing is None else from_
    bars = yahoo.chart(symbol, start).quotes
    from_date = to_utc_date(start)
    try:
        db.execute(delete(BenchmarkPrice).where(BenchmarkPrice.symbol == symbol, BenchmarkPrice.date >= from_date))
        _insert_ignore(db, BenchmarkPrice, [{"id": new_id(), "symbol": symbol, "date": to_utc_date(bar.date), "close": bar.close} for bar in bars])
        db.commit()
    except Exception:
        db.rollback()
        raise


def sync_usd_myr_rate(db: Session, from_: datetime) -> None:
    # Rows written while bars were dated by the UTC day sit one day early, some
    # on weekends. Any weekend row means the whole stored range is rewritten once.
    stored = db.scalars(
        select(ExchangeRate.date).where(ExchangeRate.from_ == Currency.USD, ExchangeRate.to == Currency.MYR).order_by(ExchangeRate.date)
    ).all()
    shifted = any(is_weekend_date(day) for day in stored)
    start = datetime(stored[0].year, stored[0].month, stored[0].day) if shifted and datetime(stored[0].year, stored[0].month, stored[0].day) < from_ else from_
    if shifted:
        log.warning("[sync] USD/MYR rows are dated a day early, rewriting stored FX history")
    bars = yahoo.chart(USD_MYR_SYMBOL, start).quotes
    from_date = to_utc_date(start)
    # The live bar and the session bar can land on the same London day; the later quote wins.
    by_date: dict[date, float] = {}
    for bar in bars:
        day = fx_bar_date(bar.date).date()
        if is_weekend_date(day) or day < from_date:
            continue
        by_date[day] = bar.close  # type: ignore[assignment]
    try:
        db.execute(
            delete(ExchangeRate).where(ExchangeRate.from_ == Currency.USD, ExchangeRate.to == Currency.MYR, ExchangeRate.date >= from_date)
        )
        _insert_ignore(
            db,
            ExchangeRate,
            [{"id": new_id(), "from": "USD", "to": "MYR", "date": day, "rate": rate} for day, rate in by_date.items()],
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


def sync_market_data(db: Session, days_back: int = 400) -> dict[str, int]:
    from_ = utcnow() - timedelta(days=days_back)
    symbols = get_tracked_symbols(db)
    for symbol in symbols:
        sync_daily_prices(db, symbol, from_)
    for benchmark in BENCHMARK_SYMBOLS:
        sync_benchmark_prices(db, benchmark, from_)
    sync_usd_myr_rate(db, from_)
    return {"symbols": len(symbols), "benchmarks": len(BENCHMARK_SYMBOLS)}


SEARCHABLE_TYPES = {"EQUITY", "ETF"}


def _is_app_market_symbol(symbol: str) -> bool:
    upper = symbol.upper()
    return upper.endswith(".KL") or "." not in upper


def search_symbols(query: str) -> list[dict[str, str]]:
    q = query.strip()
    if len(q) < 2:
        return []
    result = yahoo.search(q, 25, 0)
    hits: list[dict[str, str]] = []
    for row in result.get("quotes") or []:
        if not row.get("isYahooFinance"):
            continue
        if row.get("quoteType") not in SEARCHABLE_TYPES:
            continue
        symbol = row.get("symbol")
        if not symbol or not _is_app_market_symbol(symbol):
            continue
        hits.append(
            {
                "symbol": symbol.upper(),
                "name": row.get("shortname") or row.get("longname") or symbol,
                "exchange": row.get("exchDisp") or row.get("exchange"),
            }
        )
    return hits


# Short cache so several open tabs polling the tape share one Yahoo call.
QUOTE_TTL = 15.0
_quote_cache: dict[str, tuple[dict[str, Any], float]] = {}


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number and abs(number) != float("inf") else None


def _ticker_quote(raw: dict[str, Any]) -> dict[str, Any] | None:
    symbol = (raw.get("symbol") or "").upper()
    price = _finite(raw.get("regularMarketPrice"))
    if not symbol or price is None:
        return None
    market_time = raw.get("regularMarketTime")
    as_of = iso(yahoo.from_epoch(market_time)) if isinstance(market_time, (int, float)) else None
    change = _finite(raw.get("regularMarketChange"))
    change_pct = _finite(raw.get("regularMarketChangePercent"))
    return {
        "symbol": symbol,
        "name": raw.get("shortName") or raw.get("longName") or symbol,
        "price": price,
        "change": change if change is not None else 0,
        "changePercent": change_pct / 100 if change_pct is not None else 0,
        "currency": raw.get("currency") or "",
        "marketState": raw.get("marketState") or "UNKNOWN",
        "asOf": as_of,
    }


def get_quotes(symbols: list[str]) -> list[dict[str, Any]]:
    wanted = list(dict.fromkeys(symbol.strip().upper() for symbol in symbols if symbol.strip()))
    now = time.monotonic()
    resolved: dict[str, dict[str, Any]] = {}
    missing: list[str] = []
    for symbol in wanted:
        cached = _quote_cache.get(symbol)
        if cached and cached[1] > now:
            resolved[symbol] = cached[0]
        else:
            missing.append(symbol)
    if missing:
        for row in yahoo.quote(missing):
            parsed = _ticker_quote(row)
            if parsed is None:
                continue
            resolved[parsed["symbol"]] = parsed
            _quote_cache[parsed["symbol"]] = (parsed, now + QUOTE_TTL)
    return [resolved[symbol] for symbol in wanted if symbol in resolved]


def get_close_on_or_before(db: Session, symbol: str, on_date: date) -> dict[str, Any] | None:
    ticker = symbol.strip().upper()

    def lookup() -> DailyPrice | None:
        return db.scalars(
            select(DailyPrice).where(DailyPrice.symbol == ticker, DailyPrice.date <= on_date).order_by(DailyPrice.date.desc()).limit(1)
        ).first()

    row = lookup()
    if row is None:
        try:
            sync_daily_prices(db, ticker, datetime(on_date.year, on_date.month, on_date.day) - timedelta(days=45))
        except Exception:
            log.exception("[close] Yahoo fetch failed %s", ticker)
            return None
        row = lookup()
    if row is None:
        return None
    return {"symbol": ticker, "date": date_key(row.date), "close": float(row.close), "currency": row.currency}


TICKER = re.compile(r"^[A-Z0-9^=.-]{1,15}$")
