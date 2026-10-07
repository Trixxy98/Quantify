from sqlalchemy import DateTime, cast, delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import DailyPrice, Portfolio, PortfolioSnapshot, Transaction, TransactionType, new_id, table_of
from app.rows import currency_from_symbol
from app.services.corporate_actions import adjust_trade, load_dividends, load_splits
from app.services.fx import SeriesPoint, latest_at_or_before, load_usd_myr_series, to_base
from app.timeutil import day_ms, from_ms, ms


def _clear_snapshots(db: Session, portfolio_id: str) -> int:
    db.execute(delete(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == portfolio_id))
    db.commit()
    return 0


def rebuild_snapshots(db: Session, portfolio_id: str) -> int:
    portfolio = db.get(Portfolio, portfolio_id)
    if portfolio is None:
        return 0
    base_currency = portfolio.base_currency.value

    transactions = db.scalars(
        select(Transaction).where(Transaction.portfolio_id == portfolio_id).order_by(Transaction.date, Transaction.created_at)
    ).all()
    if not transactions:
        # All transactions deleted: clear obsolete snapshots.
        return _clear_snapshots(db, portfolio_id)

    symbols = list(dict.fromkeys(t.symbol for t in transactions))
    first_date = transactions[0].date
    prices = db.execute(
        select(DailyPrice.symbol, DailyPrice.date, DailyPrice.close)
        # Prisma compared the DATE column with the trade timestamp: a same-day bar counts only for a midnight trade.
        .where(DailyPrice.symbol.in_(symbols), cast(DailyPrice.date, DateTime) >= first_date)
        .order_by(DailyPrice.date)
    ).all()

    rate_series = load_usd_myr_series(db)
    splits = load_splits(db, symbols)
    dividends = load_dividends(db, symbols)

    # Flat, time-ordered dividend events, each paid against the quantity held when it went ex.
    dividend_events = sorted(
        ((day_ms(row.ex_date), symbol, row.amount) for symbol, rows in dividends.items() for row in rows),
        key=lambda event: event[0],
    )

    price_map: dict[str, list[SeriesPoint]] = {}
    calendar_set: set[int] = set()
    for row in prices:
        time = day_ms(row.date)
        calendar_set.add(time)
        price_map.setdefault(row.symbol, []).append({"date": time, "close": float(row.close)})
    calendar = sorted(calendar_set)
    if not calendar:
        # No bar since the first trade (e.g. its date moved later): earlier rows describe a ledger that no longer exists.
        return _clear_snapshots(db, portfolio_id)

    # Anything that went ex before the portfolio existed is not ours to collect.
    div_index = 0
    while div_index < len(dividend_events) and dividend_events[div_index][0] < calendar[0]:
        div_index += 1

    def convert(value: float, currency: str, time: int) -> float | None:
        return to_base(value, currency, base_currency, rate_series, time)

    qty_by_symbol: dict[str, float] = {}
    cost_by_symbol: dict[str, float] = {}
    tx_index = 0
    snapshots: list[dict] = []

    for time in calendar:
        while tx_index < len(transactions) and ms(transactions[tx_index].date) <= time:
            t = transactions[tx_index]
            trade_time = ms(t.date)
            q = adjust_trade(float(t.quantity), float(t.price), splits.get(t.symbol, []), trade_time)["quantity"]
            current_qty = qty_by_symbol.get(t.symbol, 0.0)
            current_cost = cost_by_symbol.get(t.symbol, 0.0)
            currency = t.currency.value
            if t.type == TransactionType.BUY:
                native = float(t.quantity) * float(t.price) + float(t.fee)
                base = convert(native, currency, trade_time)
                if base is None:
                    base = convert(native, currency, time)
                qty_by_symbol[t.symbol] = current_qty + q
                if base is not None:
                    cost_by_symbol[t.symbol] = current_cost + base
            else:
                avg = current_cost / current_qty if current_qty > 0 else 0.0
                qty_by_symbol[t.symbol] = current_qty - q
                cost_by_symbol[t.symbol] = current_cost - q * avg
            tx_index += 1

        dividend_income = 0.0
        while div_index < len(dividend_events) and dividend_events[div_index][0] <= time:
            _, symbol, amount = dividend_events[div_index]
            held = qty_by_symbol.get(symbol, 0.0)
            if held > 0:
                income = convert(held * amount, currency_from_symbol(symbol).value, time)
                if income is not None:
                    dividend_income += income
            div_index += 1

        total_value = 0.0
        total_cost = 0.0
        rate_available = True
        for symbol in symbols:
            quantity = qty_by_symbol.get(symbol, 0.0)
            if quantity <= 0:
                continue
            close = latest_at_or_before(price_map.get(symbol, []), time)
            if close is None:
                continue
            value = convert(quantity * close, currency_from_symbol(symbol).value, time)
            if value is None:
                rate_available = False
                break
            total_value += value
            total_cost += cost_by_symbol.get(symbol, 0.0)

        # Skip a date when FX is missing rather than persist a wrong value.
        if not rate_available:
            continue
        snapshots.append(
            {"date": from_ms(time).date(), "totalValue": total_value, "totalCost": total_cost, "dividendIncome": dividend_income}
        )

    if not snapshots:
        # Same rule as a partial rebuild below, which drops every stored date it did not produce.
        return _clear_snapshots(db, portfolio_id)

    dates = [row["date"] for row in snapshots]
    db.execute(delete(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == portfolio_id, PortfolioSnapshot.date.not_in(dates)))
    table = table_of(PortfolioSnapshot)
    for chunk_start in range(0, len(snapshots), 1000):
        chunk = snapshots[chunk_start : chunk_start + 1000]
        statement = insert(table).values(
            [
                {
                    "id": new_id(),
                    "portfolioId": portfolio_id,
                    "date": row["date"],
                    "totalValue": row["totalValue"],
                    "totalCost": row["totalCost"],
                    "dividendIncome": row["dividendIncome"],
                }
                for row in chunk
            ]
        )
        db.execute(
            statement.on_conflict_do_update(
                index_elements=["portfolioId", "date"],
                set_={
                    "totalValue": statement.excluded.totalValue,
                    "totalCost": statement.excluded.totalCost,
                    "dividendIncome": statement.excluded.dividendIncome,
                },
            )
        )
    db.commit()
    return len(snapshots)


def rebuild_all_snapshots(db: Session) -> int:
    ids = db.scalars(select(Portfolio.id)).all()
    for portfolio_id in ids:
        rebuild_snapshots(db, portfolio_id)
    return len(ids)
