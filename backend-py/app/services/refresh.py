import logging
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.jobs.state import is_full_sync_running
from app.models import BenchmarkPrice, Currency, DailyPrice, ExchangeRate, Transaction
from app.services import market
from app.services.snapshot import rebuild_snapshots
from app.timeutil import utcnow

log = logging.getLogger("quantify")
STALE = timedelta(days=3)


def _padded(value: datetime) -> datetime:
    return value - timedelta(days=7)


def _needs_history(first: date | None, last: date | None, from_: datetime) -> bool:
    if first is None or last is None:
        return True
    if datetime(first.year, first.month, first.day) > from_ + timedelta(days=1):
        return True
    return utcnow() - datetime(last.year, last.month, last.day) > STALE


def _ensure_daily_prices(db: Session, symbol: str, from_: datetime) -> None:
    first, last = db.execute(select(func.min(DailyPrice.date), func.max(DailyPrice.date)).where(DailyPrice.symbol == symbol)).one()
    if _needs_history(first, last, from_):
        market.sync_daily_prices(db, symbol, from_)


def _ensure_usd_myr(db: Session, from_: datetime) -> None:
    first, last = db.execute(
        select(func.min(ExchangeRate.date), func.max(ExchangeRate.date)).where(
            ExchangeRate.from_ == Currency.USD, ExchangeRate.to == Currency.MYR
        )
    ).one()
    if _needs_history(first, last, from_):
        market.sync_usd_myr_rate(db, from_)


def _ensure_benchmarks(db: Session, from_: datetime) -> None:
    for symbol in market.BENCHMARK_SYMBOLS:
        first, last = db.execute(
            select(func.min(BenchmarkPrice.date), func.max(BenchmarkPrice.date)).where(BenchmarkPrice.symbol == symbol)
        ).one()
        if _needs_history(first, last, from_):
            market.sync_benchmark_prices(db, symbol, from_)


def refresh_portfolio_after_trade(db: Session, portfolio_id: str, symbols: list[str]) -> None:
    if is_full_sync_running():
        return
    unique = list(dict.fromkeys(symbol.upper() for symbol in symbols if symbol))
    for symbol in unique:
        earliest = db.scalar(
            select(func.min(Transaction.date)).where(Transaction.portfolio_id == portfolio_id, Transaction.symbol == symbol)
        )
        if earliest is None:
            continue
        _ensure_daily_prices(db, symbol, _padded(earliest))

    first_tx = db.scalar(select(func.min(Transaction.date)).where(Transaction.portfolio_id == portfolio_id))
    if first_tx is not None:
        from_ = _padded(first_tx)
        _ensure_usd_myr(db, from_)
        _ensure_benchmarks(db, from_)
    rebuild_snapshots(db, portfolio_id)


def refresh_portfolio_after_trade_quietly(db: Session, portfolio_id: str, symbols: list[str]) -> None:
    try:
        refresh_portfolio_after_trade(db, portfolio_id, symbols)
    except Exception:
        db.rollback()
        log.exception("[trade] market refresh failed %s %s", portfolio_id, symbols)
