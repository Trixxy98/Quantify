from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Transaction, TransactionType
from app.rows import locale_key
from app.services.corporate_actions import SplitRow, adjust_trade, load_splits
from app.services.fx import load_usd_myr_series, to_base
from app.timeutil import date_key, ms, utcnow


@dataclass
class LotTrade:
    id: str
    symbol: str
    type: str
    quantity: float
    price: float
    fee: float
    date: datetime
    created_at: datetime
    currency: str


ToBaseFn = Callable[[float, str, int], float | None]


@dataclass
class _Cycle:
    opened_at: datetime
    buy_qty: float = 0.0
    cost_native: float = 0.0
    cost_base: float = 0.0
    proceeds_native: float = 0.0
    proceeds_base: float = 0.0


@dataclass
class _Acc:
    qty: float
    native_cost: float
    base_cost: float
    currency: str
    cycle: _Cycle | None


def replay_realized(
    trades: Sequence[LotTrade], splits_by_symbol: Mapping[str, Sequence[SplitRow]], to_base_fn: ToBaseFn
) -> tuple[dict[str, dict], list[dict]]:
    """
    Weighted-average realized P&L. A closed lot is one round trip: first buy
    after flat until the position is sold back to zero. Partial sells book
    realized P&L but do not emit a lot until the book is flat.
    """
    sells: dict[str, dict] = {}
    lots: list[dict] = []
    by_symbol: dict[str, _Acc] = {}

    ordered = sorted(trades, key=lambda t: (ms(t.date), ms(t.created_at), locale_key(t.id)))
    for t in ordered:
        acc = by_symbol.get(t.symbol) or _Acc(0.0, 0.0, 0.0, t.currency, None)
        q = adjust_trade(t.quantity, t.price, splits_by_symbol.get(t.symbol, []), ms(t.date))["quantity"]
        time = ms(t.date)

        def convert(value: float, currency: str = t.currency, at: int = time) -> float:
            converted = to_base_fn(value, currency, at)
            return converted if converted is not None else 0.0

        if t.type == TransactionType.BUY:
            native = t.quantity * t.price + t.fee
            base = convert(native)
            if acc.qty <= 1e-9:
                acc.cycle = _Cycle(opened_at=t.date)
            acc.qty += q
            acc.native_cost += native
            acc.base_cost += base
            if acc.cycle:
                acc.cycle.buy_qty += q
                acc.cycle.cost_native += native
                acc.cycle.cost_base += base
        elif acc.qty > 1e-9:
            avg_native = acc.native_cost / acc.qty
            avg_base = acc.base_cost / acc.qty
            proceeds = t.quantity * t.price - t.fee
            proceeds_base = convert(proceeds)
            cost = q * avg_native
            cost_base = q * avg_base
            realized = proceeds - cost
            realized_base = proceeds_base - cost_base
            remaining = acc.qty - q
            closed = remaining <= 1e-9

            if acc.cycle:
                acc.cycle.proceeds_native += proceeds
                acc.cycle.proceeds_base += proceeds_base

            sells[t.id] = {
                "transactionId": t.id,
                "symbol": t.symbol,
                "quantity": q,
                "avgCost": avg_native,
                "proceeds": proceeds,
                "cost": cost,
                "costBase": cost_base,
                "realizedPnL": realized,
                "realizedPnLPct": realized / cost if cost > 0 else 0,
                "realizedPnLBase": realized_base,
                "closedPosition": closed,
            }

            acc.qty = max(0.0, remaining)
            acc.native_cost -= cost
            acc.base_cost -= q * avg_base

            if closed and acc.cycle:
                cycle = acc.cycle
                lots.append(
                    {
                        "symbol": t.symbol,
                        "currency": acc.currency,
                        "openedAt": date_key(cycle.opened_at),
                        "closedAt": date_key(t.date),
                        "quantity": cycle.buy_qty,
                        "cost": cycle.cost_native,
                        "proceeds": cycle.proceeds_native,
                        "realizedPnL": cycle.proceeds_native - cycle.cost_native,
                        "realizedPnLPct": (cycle.proceeds_native - cycle.cost_native) / cycle.cost_native if cycle.cost_native > 0 else 0,
                        "realizedPnLBase": cycle.proceeds_base - cycle.cost_base,
                    }
                )
                acc.cycle = None
                acc.qty = 0.0
                acc.native_cost = 0.0
                acc.base_cost = 0.0

        acc.currency = t.currency
        by_symbol[t.symbol] = acc

    lots.sort(key=lambda lot: locale_key(lot["symbol"]))
    lots.sort(key=lambda lot: lot["closedAt"], reverse=True)
    return sells, lots


def realize_portfolio(db: Session, portfolio_id: str, base_currency: str) -> tuple[dict[str, dict], list[dict]]:
    rows = db.scalars(
        select(Transaction).where(Transaction.portfolio_id == portfolio_id).order_by(Transaction.date, Transaction.created_at)
    ).all()
    trades = [
        LotTrade(
            id=t.id,
            symbol=t.symbol,
            type=t.type.value,
            quantity=float(t.quantity),
            price=float(t.price),
            fee=float(t.fee),
            date=t.date,
            created_at=t.created_at,
            currency=t.currency.value,
        )
        for t in rows
    ]
    splits = load_splits(db, {t.symbol for t in trades})
    series = load_usd_myr_series(db)
    last_fx_time = series[-1]["date"] if series else ms(utcnow())

    def to_base_fn(value: float, from_: str, time: int) -> float | None:
        converted = to_base(value, from_, base_currency, series, time)
        return converted if converted is not None else to_base(value, from_, base_currency, series, last_fx_time)

    return replay_realized(trades, splits, to_base_fn)
