import math
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import Holding, Portfolio, StockSplit, Transaction, TransactionType, new_id, table_of
from app.rows import exchange_from_symbol, js_number_string, row_dict
from app.services.corporate_actions import SplitRow, adjust_trade
from app.services.lots import realize_portfolio
from app.services.valuation import mark_open_positions
from app.timeutil import ms, utcnow


def get_owned_portfolio(db: Session, portfolio_id: str, user_id: str) -> Portfolio:
    portfolio = db.get(Portfolio, portfolio_id)
    if portfolio is None or portfolio.user_id != user_id:
        raise AppError(404, "NOT_FOUND", "Portfolio not found")
    return portfolio


def list_portfolios(db: Session, user_id: str) -> list[dict[str, Any]]:
    rows = db.scalars(select(Portfolio).where(Portfolio.user_id == user_id).order_by(Portfolio.created_at)).all()
    return [row_dict(row) for row in rows]


def create_portfolio(db: Session, user_id: str, name: str, base_currency: str) -> dict[str, Any]:
    portfolio = Portfolio(user_id=user_id, name=name, base_currency=base_currency)
    db.add(portfolio)
    db.commit()
    return row_dict(portfolio)


def update_portfolio(db: Session, portfolio_id: str, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    portfolio = get_owned_portfolio(db, portfolio_id, user_id)
    if "name" in data:
        portfolio.name = data["name"]
    if "baseCurrency" in data:
        portfolio.base_currency = data["baseCurrency"]
    portfolio.updated_at = utcnow()
    db.commit()
    return row_dict(portfolio)


def delete_portfolio(db: Session, portfolio_id: str, user_id: str) -> None:
    get_owned_portfolio(db, portfolio_id, user_id)
    db.execute(delete(Portfolio).where(Portfolio.id == portfolio_id))
    db.commit()


def list_holdings(db: Session, portfolio_id: str, user_id: str) -> list[dict[str, Any]]:
    portfolio = get_owned_portfolio(db, portfolio_id, user_id)
    holdings = db.scalars(select(Holding).where(Holding.portfolio_id == portfolio_id).order_by(Holding.symbol)).all()
    marks = {mark.symbol: mark for mark in mark_open_positions(db, portfolio_id, portfolio.base_currency.value)}
    out = []
    for holding in holdings:
        mark = marks.get(holding.symbol)
        out.append(
            {
                **row_dict(holding),
                "lastPrice": js_number_string(mark.last_price) if mark and mark.last_price is not None else None,
                "marketValue": mark.market_value if mark else None,
                "unrealizedPnL": mark.unrealized_pnl if mark else None,
                "unrealizedPnLPct": mark.unrealized_pnl_pct if mark else None,
            }
        )
    return out


def _recompute_holding(db: Session, portfolio_id: str, symbol: str, currency: str) -> None:
    """
    Replay this symbol's trades by date and recompute quantity and weighted
    average cost on Yahoo's post-split share basis. Delete the holding at zero.
    """
    transactions = db.scalars(
        select(Transaction)
        .where(Transaction.portfolio_id == portfolio_id, Transaction.symbol == symbol)
        .order_by(Transaction.date, Transaction.created_at)
    ).all()
    splits = [
        SplitRow(datetime(row.date.year, row.date.month, row.date.day), row.numerator, row.denominator)
        for row in db.scalars(select(StockSplit).where(StockSplit.symbol == symbol).order_by(StockSplit.date)).all()
    ]

    quantity = 0.0
    total_cost = 0.0
    for t in transactions:
        raw_qty = float(t.quantity)
        price = float(t.price)
        fee = float(t.fee)
        q = adjust_trade(raw_qty, price, splits, ms(t.date))["quantity"]
        if t.type == TransactionType.BUY:
            total_cost += raw_qty * price + fee
            quantity += q
        else:
            if q > quantity + 1e-9:
                raise AppError(
                    400,
                    "INVALID_TRANSACTION",
                    f"Selling {js_number_string(q)} {symbol} exceeds available quantity {js_number_string(quantity)}",
                )
            avg = total_cost / quantity
            total_cost -= q * avg
            quantity -= q

    if quantity <= 1e-9:
        db.execute(delete(Holding).where(Holding.portfolio_id == portfolio_id, Holding.symbol == symbol))
        return

    avg_cost = total_cost / quantity
    now = utcnow()
    statement = insert(table_of(Holding)).values(
        id=new_id(),
        portfolioId=portfolio_id,
        symbol=symbol,
        exchange=exchange_from_symbol(symbol).value,
        currency=currency,
        quantity=quantity,
        avgCost=avg_cost,
        createdAt=now,
        updatedAt=now,
    )
    db.execute(
        statement.on_conflict_do_update(
            index_elements=["portfolioId", "symbol"],
            set_={"quantity": quantity, "avgCost": avg_cost, "currency": currency, "updatedAt": now},
        )
    )


def recompute_portfolio_holdings(db: Session, portfolio_id: str) -> None:
    rows = db.execute(
        select(Transaction.symbol, Transaction.currency)
        .where(Transaction.portfolio_id == portfolio_id)
        .order_by(Transaction.symbol)
        .distinct(Transaction.symbol)
    ).all()
    try:
        for row in rows:
            _recompute_holding(db, portfolio_id, row.symbol, row.currency.value)
        db.commit()
    except Exception:
        db.rollback()
        raise


def _refresh_quietly(db: Session, portfolio_id: str, symbols: list[str]) -> None:
    from app.services.refresh import refresh_portfolio_after_trade_quietly

    refresh_portfolio_after_trade_quietly(db, portfolio_id, symbols)


def create_transaction(db: Session, portfolio_id: str, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    get_owned_portfolio(db, portfolio_id, user_id)
    symbol = data["symbol"].upper()
    transaction = Transaction(
        portfolio_id=portfolio_id,
        symbol=symbol,
        type=data["type"],
        quantity=Decimal(str(data["quantity"])),
        price=Decimal(str(data["price"])),
        currency=data["currency"],
        fee=Decimal(str(data["fee"])),
        date=data["date"],
    )
    try:
        db.add(transaction)
        db.flush()
        _recompute_holding(db, portfolio_id, symbol, data["currency"])
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(transaction)
    result = row_dict(transaction)
    _refresh_quietly(db, portfolio_id, [symbol])
    return result


def update_transaction(db: Session, portfolio_id: str, transaction_id: str, user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    get_owned_portfolio(db, portfolio_id, user_id)
    symbol = data["symbol"].upper()
    try:
        existing = db.get(Transaction, transaction_id)
        if existing is None or existing.portfolio_id != portfolio_id:
            raise AppError(404, "NOT_FOUND", "Transaction not found")
        previous_symbol = existing.symbol
        previous_currency = existing.currency.value
        existing.symbol = symbol
        existing.type = data["type"]
        existing.quantity = Decimal(str(data["quantity"]))
        existing.price = Decimal(str(data["price"]))
        existing.currency = data["currency"]
        existing.fee = Decimal(str(data["fee"]))
        existing.date = data["date"]
        db.flush()
        _recompute_holding(db, portfolio_id, previous_symbol, data["currency"] if previous_symbol == symbol else previous_currency)
        if symbol != previous_symbol:
            _recompute_holding(db, portfolio_id, symbol, data["currency"])
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(existing)
    result = row_dict(existing)
    _refresh_quietly(db, portfolio_id, [previous_symbol, symbol])
    return result


def delete_transaction(db: Session, portfolio_id: str, transaction_id: str, user_id: str) -> None:
    get_owned_portfolio(db, portfolio_id, user_id)
    try:
        existing = db.get(Transaction, transaction_id)
        if existing is None or existing.portfolio_id != portfolio_id:
            raise AppError(404, "NOT_FOUND", "Transaction not found")
        symbol = existing.symbol
        currency = existing.currency.value
        db.delete(existing)
        db.flush()
        _recompute_holding(db, portfolio_id, symbol, currency)
        db.commit()
    except Exception:
        db.rollback()
        raise
    _refresh_quietly(db, portfolio_id, [symbol])


def list_transactions(db: Session, portfolio_id: str, user_id: str, symbol: str | None, page: int, limit: int) -> dict[str, Any]:
    portfolio = get_owned_portfolio(db, portfolio_id, user_id)
    conditions = [Transaction.portfolio_id == portfolio_id]
    if symbol:
        conditions.append(Transaction.symbol == symbol.upper())
    rows = db.scalars(
        select(Transaction)
        .where(*conditions)
        .order_by(Transaction.date.desc(), Transaction.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    ).all()
    total = db.scalar(select(func.count()).select_from(Transaction).where(*conditions)) or 0
    sells, _ = realize_portfolio(db, portfolio_id, portfolio.base_currency.value)
    data = []
    for row in rows:
        sell = sells.get(row.id)
        data.append(
            {
                **row_dict(row),
                "realizedPnL": sell["realizedPnL"] if sell else None,
                "realizedPnLPct": sell["realizedPnLPct"] if sell else None,
                "realizedPnLBase": sell["realizedPnLBase"] if sell else None,
                "closedPosition": sell["closedPosition"] if sell else False,
            }
        )
    return {"data": data, "pagination": {"page": page, "limit": limit, "total": total, "totalPages": math.ceil(total / limit)}}


def list_closed_lots(db: Session, portfolio_id: str, user_id: str) -> dict[str, Any]:
    portfolio = get_owned_portfolio(db, portfolio_id, user_id)
    _, lots = realize_portfolio(db, portfolio_id, portfolio.base_currency.value)
    return {"baseCurrency": portfolio.base_currency, "lots": lots}
