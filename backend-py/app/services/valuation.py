from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import DailyPrice, Exchange, Transaction, TransactionType
from app.rows import currency_from_symbol, exchange_from_symbol, locale_key
from app.services.corporate_actions import adjust_trade, load_splits
from app.services.fx import load_usd_myr_series, to_base
from app.timeutil import ms, utcnow


@dataclass
class OpenPositionMark:
    symbol: str
    exchange: Exchange
    currency: str
    quantity: float
    avg_cost: float
    base_cost: float
    last_price: float | None
    last_price_date: date | None
    market_value: float | None
    unrealized_pnl: float | None
    unrealized_pnl_pct: float | None


@dataclass
class _Acc:
    qty: float
    native_cost: float
    base_cost: float
    currency: str


def mark_open_positions(db: Session, portfolio_id: str, base_currency: str) -> list[OpenPositionMark]:
    """
    Open lots with cost in base currency at trade-time FX (same as snapshots)
    and market value at the latest FX. That is the portfolio P&L definition.
    """
    transactions = db.scalars(
        select(Transaction).where(Transaction.portfolio_id == portfolio_id).order_by(Transaction.date, Transaction.created_at)
    ).all()
    series = load_usd_myr_series(db)
    last_fx_time = series[-1]["date"] if series else ms(utcnow())
    splits = load_splits(db, {t.symbol for t in transactions})

    by_symbol: dict[str, _Acc] = {}
    for t in transactions:
        acc = by_symbol.get(t.symbol) or _Acc(0.0, 0.0, 0.0, t.currency.value)
        time = ms(t.date)
        q = adjust_trade(float(t.quantity), float(t.price), splits.get(t.symbol, []), time)["quantity"]
        if t.type == TransactionType.BUY:
            native = float(t.quantity) * float(t.price) + float(t.fee)
            base = to_base(native, t.currency.value, base_currency, series, time)
            if base is None:
                base = to_base(native, t.currency.value, base_currency, series, last_fx_time)
            acc.qty += q
            acc.native_cost += native
            if base is not None:
                acc.base_cost += base
        elif acc.qty > 1e-9:
            avg_native = acc.native_cost / acc.qty
            avg_base = acc.base_cost / acc.qty
            acc.qty -= q
            acc.native_cost -= q * avg_native
            acc.base_cost -= q * avg_base
        acc.currency = t.currency.value
        by_symbol[t.symbol] = acc

    marks: list[OpenPositionMark] = []
    for symbol, acc in by_symbol.items():
        if acc.qty <= 1e-9:
            continue
        last = db.scalars(select(DailyPrice).where(DailyPrice.symbol == symbol).order_by(DailyPrice.date.desc()).limit(1)).first()
        currency = acc.currency or currency_from_symbol(symbol).value
        avg_cost = acc.native_cost / acc.qty if acc.qty > 0 else 0.0
        market_value: float | None = None
        unrealized: float | None = None
        unrealized_pct: float | None = None
        if last is not None:
            market_value = to_base(acc.qty * float(last.close), currency, base_currency, series, last_fx_time)
            if market_value is not None:
                unrealized = market_value - acc.base_cost
                unrealized_pct = unrealized / acc.base_cost if acc.base_cost > 0 else 0.0
        marks.append(
            OpenPositionMark(
                symbol=symbol,
                exchange=exchange_from_symbol(symbol),
                currency=currency,
                quantity=acc.qty,
                avg_cost=avg_cost,
                base_cost=acc.base_cost,
                last_price=float(last.close) if last is not None else None,
                last_price_date=last.date if last is not None else None,
                market_value=market_value,
                unrealized_pnl=unrealized,
                unrealized_pnl_pct=unrealized_pct,
            )
        )
    return sorted(marks, key=lambda mark: locale_key(mark.symbol))
