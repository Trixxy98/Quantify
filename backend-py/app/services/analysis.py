import math
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BenchmarkPrice, DailyPrice, Exchange, Transaction, TransactionType
from app.rows import currency_from_symbol, exchange_from_symbol
from app.services.date_range import resolve_range_start
from app.services.fx import SeriesPoint, latest_at_or_before, load_usd_myr_series, to_base
from app.services.portfolio import get_owned_portfolio
from app.services.stats import covariance, variance
from app.services.valuation import mark_open_positions
from app.timeutil import date_key, day_ms, ms

BURSA_BENCHMARK = "^KLSE"
US_BENCHMARK = "^GSPC"
MIN_BETA_OBS = 10
MIN_RISK_OBS = 5
BETA_MIN = -2
BETA_MAX = 3


def _fx_sensitivity(currency: str, base: str) -> int:
    if currency == base:
        return 0
    if base == "MYR" and currency == "USD":
        return 1
    if base == "USD" and currency == "MYR":
        return -1
    return 0


def _apply_tx(qty: dict[str, float], kind: TransactionType, symbol: str, quantity: float) -> None:
    current = qty.get(symbol, 0.0)
    nxt = current + quantity if kind == TransactionType.BUY else current - quantity
    qty[symbol] = 0.0 if nxt <= 1e-9 else nxt


def _price_at(series: list[SeriesPoint] | None, time: int) -> float | None:
    if not series:
        return None
    return latest_at_or_before(series, time)


def _compute_beta(stock: list[SeriesPoint], bench: list[SeriesPoint], start_time: int) -> float:
    r_stock: list[float] = []
    r_bench: list[float] = []
    for i in range(1, len(stock)):
        if stock[i]["date"] < start_time:
            continue
        p0 = stock[i - 1]["close"]
        p1 = stock[i]["close"]
        b0 = latest_at_or_before(bench, stock[i - 1]["date"])
        b1 = latest_at_or_before(bench, stock[i]["date"])
        if p0 > 0 and b0 is not None and b1 is not None and b0 > 0:
            r_stock.append((p1 - p0) / p0)
            r_bench.append((b1 - b0) / b0)
    if len(r_stock) < MIN_BETA_OBS:
        return 1
    v = variance(r_bench)
    if not math.isfinite(v) or v < 1e-12:
        return 1
    return min(BETA_MAX, max(BETA_MIN, covariance(r_stock, r_bench) / v))


def _total(values: list[float]) -> float:
    out = 0.0
    for value in values:
        out += value
    return out


def get_analysis(db: Session, portfolio_id: str, user_id: str, range_: str) -> dict[str, Any]:
    portfolio = get_owned_portfolio(db, portfolio_id, user_id)
    base = portfolio.base_currency.value
    priced = [mark for mark in mark_open_positions(db, portfolio_id, base) if mark.market_value is not None]
    total_value = _total([mark.market_value for mark in priced])  # type: ignore[misc]
    as_of: str | None = None
    for mark in priced:
        if mark.last_price_date is None:
            continue
        key = date_key(mark.last_price_date)
        if as_of is None or key > as_of:
            as_of = key

    def empty(positions: list[dict[str, Any]], items: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        return {
            "range": range_,
            "asOf": as_of,
            "baseCurrency": portfolio.base_currency,
            "days": 0,
            "totalValue": total_value,
            "totalContribution": 0,
            "stockContribution": 0,
            "fxContribution": 0,
            "items": items or [],
            "scenario": {"totalValue": total_value, "positions": positions},
        }

    transactions = db.scalars(
        select(Transaction).where(Transaction.portfolio_id == portfolio_id).order_by(Transaction.date, Transaction.created_at)
    ).all()
    if not transactions:
        return empty([])

    symbols = list(dict.fromkeys(t.symbol for t in transactions))
    start = resolve_range_start(range_)
    start_time = day_ms(start) if start else 0

    prices = db.execute(select(DailyPrice.symbol, DailyPrice.date, DailyPrice.close).where(DailyPrice.symbol.in_(symbols)).order_by(DailyPrice.date)).all()
    fx_series = load_usd_myr_series(db)
    benchmarks = db.execute(
        select(BenchmarkPrice.symbol, BenchmarkPrice.date, BenchmarkPrice.close)
        .where(BenchmarkPrice.symbol.in_([BURSA_BENCHMARK, US_BENCHMARK]))
        .order_by(BenchmarkPrice.date)
    ).all()

    price_map: dict[str, list[SeriesPoint]] = {}
    calendar_set: set[int] = set()
    for row in prices:
        time = day_ms(row.date)
        calendar_set.add(time)
        price_map.setdefault(row.symbol, []).append({"date": time, "close": float(row.close)})
    calendar = sorted(calendar_set)

    klci: list[SeriesPoint] = []
    spx: list[SeriesPoint] = []
    for row in benchmarks:
        point: SeriesPoint = {"date": day_ms(row.date), "close": float(row.close)}
        (klci if row.symbol == BURSA_BENCHMARK else spx).append(point)

    beta_by = {
        symbol: _compute_beta(price_map.get(symbol, []), klci if exchange_from_symbol(symbol) == Exchange.BURSA else spx, start_time)
        for symbol in symbols
    }
    positions = [
        {
            "symbol": mark.symbol,
            "exchange": mark.exchange,
            "marketValue": mark.market_value,
            "beta": beta_by.get(mark.symbol, 1),
            "fxSensitivity": _fx_sensitivity(mark.currency, base),
        }
        for mark in priced
    ]
    if len(calendar) < 2:
        return empty(positions)

    qty: dict[str, float] = {}
    tx_index = 0
    while tx_index < len(transactions) and ms(transactions[tx_index].date) < calendar[0]:
        t = transactions[tx_index]
        _apply_tx(qty, t.type, t.symbol, float(t.quantity))
        tx_index += 1

    stock_by: dict[str, float] = {}
    fx_by: dict[str, float] = {}
    contrib_days: list[list[float]] = []
    symbol_index = {symbol: i for i, symbol in enumerate(symbols)}
    prev_time: int | None = None

    for time in calendar:
        if prev_time is not None and time >= start_time:
            day = [0.0] * len(symbols)
            port_prev = 0.0
            pnls: list[tuple[str, float]] = []
            for symbol in symbols:
                q = qty.get(symbol, 0.0)
                if q <= 1e-9:
                    continue
                p0 = _price_at(price_map.get(symbol), prev_time)
                p1 = _price_at(price_map.get(symbol), time)
                ccy = currency_from_symbol(symbol).value
                fx0 = to_base(1, ccy, base, fx_series, prev_time)
                fx1 = to_base(1, ccy, base, fx_series, time)
                if p0 is None or p1 is None or fx0 is None or fx1 is None:
                    continue
                port_prev += q * p0 * fx0
                d_p = p1 - p0
                d_fx = fx1 - fx0
                stock_part = q * d_p * fx0
                fx_part = q * p0 * d_fx + q * d_p * d_fx
                stock_by[symbol] = stock_by.get(symbol, 0.0) + stock_part
                fx_by[symbol] = fx_by.get(symbol, 0.0) + fx_part
                pnls.append((symbol, stock_part + fx_part))
            if port_prev > 1e-6:
                for symbol, pnl in pnls:
                    day[symbol_index[symbol]] = pnl / port_prev
                contrib_days.append(day)
        while tx_index < len(transactions) and ms(transactions[tx_index].date) <= time:
            t = transactions[tx_index]
            _apply_tx(qty, t.type, t.symbol, float(t.quantity))
            tx_index += 1
        prev_time = time

    days = len(contrib_days)
    risk_share_by: dict[str, float] = {}
    if days >= MIN_RISK_OBS:
        rp = [_total(day) for day in contrib_days]
        var_p = variance(rp)
        if math.isfinite(var_p) and var_p > 1e-16:
            for symbol in symbols:
                i = symbol_index[symbol]
                risk_share_by[symbol] = covariance([day[i] for day in contrib_days], rp) / var_p

    mv_by = {mark.symbol: mark.market_value for mark in priced}
    shown = list(dict.fromkeys([*(mark.symbol for mark in priced), *stock_by.keys(), *fx_by.keys()]))
    items: list[dict[str, Any]] = []
    for symbol in shown:
        stock_c = stock_by.get(symbol, 0.0)
        fx_c = fx_by.get(symbol, 0.0)
        contribution = stock_c + fx_c
        market_value = mv_by.get(symbol)
        weight = market_value / total_value if total_value > 0 and market_value is not None else 0
        items.append(
            {
                "symbol": symbol,
                "exchange": exchange_from_symbol(symbol),
                "currency": currency_from_symbol(symbol),
                "marketValue": market_value,
                "weight": weight,
                "contribution": contribution,
                "contributionShare": 0,
                "stockContribution": stock_c,
                "fxContribution": fx_c,
                "riskShare": risk_share_by.get(symbol, weight),
                "beta": beta_by.get(symbol, 1),
            }
        )
    items = [item for item in items if item["marketValue"] is not None or abs(item["contribution"]) > 0.005]
    items.sort(key=lambda item: item["contribution"], reverse=True)

    total_contribution = _total([item["contribution"] for item in items])
    stock_contribution = _total([item["stockContribution"] for item in items])
    fx_contribution = _total([item["fxContribution"] for item in items])
    for item in items:
        item["contributionShare"] = item["contribution"] / total_contribution if total_contribution != 0 else 0

    return {
        "range": range_,
        "asOf": as_of,
        "baseCurrency": portfolio.base_currency,
        "days": days,
        "totalValue": total_value,
        "totalContribution": total_contribution,
        "stockContribution": stock_contribution,
        "fxContribution": fx_contribution,
        "items": items,
        "scenario": {"totalValue": total_value, "positions": positions},
    }
