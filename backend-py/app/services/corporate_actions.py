from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Dividend, StockSplit
from app.timeutil import ms

# A restated series shows up as a step change on a date already stored. 0.5%
# sits far below the smallest real split (2:1) and far above rounding drift.
REBASE_TOLERANCE = 0.005


@dataclass
class SplitRow:
    date: datetime  # midnight UTC, naive
    numerator: int
    denominator: int


@dataclass
class DividendRow:
    ex_date: date
    amount: float


def is_rebased(stored_close: float, fetched_close: float) -> bool:
    """True when Yahoo now reports a materially different close for a stored date: the series was restated."""
    if not (stored_close > 0) or not (fetched_close > 0):
        return False
    return abs(fetched_close / stored_close - 1) > REBASE_TOLERANCE


def split_factor_after(splits: Sequence[SplitRow], trade_time: int) -> float:
    """
    Cumulative split ratio for splits strictly after `trade_time` (epoch ms).
    Yahoo restates history in post-split terms but a stored trade keeps its
    traded share count, so every trade is pushed through later splits.
    """
    factor = 1.0
    for split in splits:
        if split.denominator <= 0 or split.numerator <= 0:
            continue
        if ms(split.date) > trade_time:
            factor *= split.numerator / split.denominator
    return factor


def adjust_trade(quantity: float, price: float, splits: Sequence[SplitRow], trade_time: int) -> dict[str, float]:
    """One trade in post-split terms. Cost (quantity × price) is unchanged."""
    factor = split_factor_after(splits, trade_time)
    if factor == 1:
        return {"quantity": quantity, "price": price}
    return {"quantity": quantity * factor, "price": price / factor}


def load_splits(db: Session, symbols: Iterable[str]) -> dict[str, list[SplitRow]]:
    wanted = list(symbols)
    out: dict[str, list[SplitRow]] = {}
    if not wanted:
        return out
    rows = db.scalars(select(StockSplit).where(StockSplit.symbol.in_(wanted)).order_by(StockSplit.date)).all()
    for row in rows:
        out.setdefault(row.symbol, []).append(
            SplitRow(datetime(row.date.year, row.date.month, row.date.day), row.numerator, row.denominator)
        )
    return out


def load_dividends(db: Session, symbols: Iterable[str]) -> dict[str, list[DividendRow]]:
    wanted = list(symbols)
    out: dict[str, list[DividendRow]] = {}
    if not wanted:
        return out
    rows = db.scalars(select(Dividend).where(Dividend.symbol.in_(wanted)).order_by(Dividend.ex_date)).all()
    for row in rows:
        out.setdefault(row.symbol, []).append(DividendRow(row.ex_date, float(row.amount)))
    return out
