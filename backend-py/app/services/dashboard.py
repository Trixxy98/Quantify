from dataclasses import dataclass
from typing import Any

from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import AppError
from app.models import BenchmarkPrice, DailyPrice, Exchange, Holding, PortfolioSnapshot, Transaction, TransactionType
from app.research.bootstrap import stationary_bootstrap
from app.rows import currency_from_symbol
from app.services.date_range import resolve_range_start
from app.services.fx import SeriesPoint, latest_at_or_before, load_usd_myr_series, to_base
from app.services.lots import realize_portfolio
from app.services.metrics import (
    DailyValue,
    alpha,
    annualized_return,
    beta,
    cagr,
    cagr_from_returns,
    composite_benchmark_returns,
    index_to_100,
    max_drawdown,
    max_drawdown_from_returns,
    sharpe_ratio,
    sharpe_standard_error,
    time_weighted_index,
    to_daily_returns,
    volatility,
)
from app.services.portfolio import get_owned_portfolio
from app.services.valuation import mark_open_positions
from app.timeutil import date_key, day_ms, ms, parse_date

BURSA_BENCHMARK = "^KLSE"
US_TOTAL_RETURN = "^SP500TR"
US_PRICE_INDEX = "^GSPC"
# Sharpe/vol/beta below this many observations are noise, not estimates.
LOW_CONFIDENCE_OBSERVATIONS = 60
YEAR_MS = 365.25 * 24 * 60 * 60 * 1000


@dataclass
class SnapshotRow:
    date: str
    value: float
    income: float


@dataclass
class Aligned:
    p_series: list[DailyValue]
    k_series: list[DailyValue]
    g_series: list[DailyValue]


def load_snapshots(db: Session, portfolio_id: str, range_: str) -> list[SnapshotRow]:
    start = resolve_range_start(range_)
    conditions = [PortfolioSnapshot.portfolio_id == portfolio_id]
    if start:
        conditions.append(PortfolioSnapshot.date >= start)
    rows = db.scalars(select(PortfolioSnapshot).where(*conditions).order_by(PortfolioSnapshot.date)).all()
    return [SnapshotRow(date_key(row.date), float(row.total_value), float(row.dividend_income)) for row in rows]


def _nav(rows: list[SnapshotRow]) -> list[DailyValue]:
    return [{"date": row.date, "value": row.value} for row in rows]


def resolve_us_benchmark(db: Session) -> str:
    """Total-return index when it is synced; never mix the two, their levels differ."""
    total_return = db.scalar(select(func.count()).select_from(BenchmarkPrice).where(BenchmarkPrice.symbol == US_TOTAL_RETURN)) or 0
    price_index = db.scalar(select(func.count()).select_from(BenchmarkPrice).where(BenchmarkPrice.symbol == US_PRICE_INDEX)) or 0
    return US_TOTAL_RETURN if total_return > 0 and total_return >= price_index * 0.9 else US_PRICE_INDEX


def cash_flow_by_snapshot_date(db: Session, portfolio_id: str, base_currency: str, snapshots: list[DailyValue]) -> dict[str, float]:
    flows: dict[str, float] = {}
    if len(snapshots) < 2:
        return flows
    transactions = db.scalars(
        select(Transaction).where(Transaction.portfolio_id == portfolio_id).order_by(Transaction.date, Transaction.created_at)
    ).all()
    fx_series = load_usd_myr_series(db)
    first_time = day_ms(parse_date(snapshots[0]["date"]))
    tx_index = 0
    while tx_index < len(transactions) and ms(transactions[tx_index].date) <= first_time:
        tx_index += 1
    for i in range(1, len(snapshots)):
        time = day_ms(parse_date(snapshots[i]["date"]))
        cash_flow = 0.0
        while tx_index < len(transactions) and ms(transactions[tx_index].date) <= time:
            t = transactions[tx_index]
            qty = float(t.quantity)
            native = qty * float(t.price) + float(t.fee) if t.type == TransactionType.BUY else -(qty * float(t.price) - float(t.fee))
            base = to_base(native, t.currency.value, base_currency, fx_series, ms(t.date))
            if base is not None:
                cash_flow += base
            tx_index += 1
        flows[snapshots[i]["date"]] = cash_flow
    return flows


def build_twr_series(db: Session, portfolio_id: str, base_currency: str, rows: list[SnapshotRow]) -> list[DailyValue]:
    """The one place NAV becomes a return series: deposits and withdrawals stripped, dividends added back."""
    nav = _nav(rows)
    flows = cash_flow_by_snapshot_date(db, portfolio_id, base_currency, nav)
    return time_weighted_index(nav, flows, {row.date: row.income for row in rows})


def get_benchmark_weights(db: Session, portfolio_id: str, base_currency: str) -> dict[str, float]:
    priced = [mark for mark in mark_open_positions(db, portfolio_id, base_currency) if mark.market_value is not None]
    total = sum(mark.market_value for mark in priced)  # type: ignore[misc]
    if total == 0:
        return {"bursa": 1, "us": 0}
    bursa = sum(mark.market_value for mark in priced if mark.exchange == Exchange.BURSA) / total  # type: ignore[misc]
    return {"bursa": bursa, "us": 1 - bursa}


def load_aligned_benchmark(db: Session, portfolio_series: list[DailyValue], weights: dict[str, float], range_: str, us_benchmark: str) -> Aligned:
    start = resolve_range_start(range_)
    conditions: list[ColumnElement[bool]] = [BenchmarkPrice.symbol.in_([BURSA_BENCHMARK, us_benchmark])]
    if start:
        conditions.append(BenchmarkPrice.date >= start)
    rows = db.execute(select(BenchmarkPrice.symbol, BenchmarkPrice.date, BenchmarkPrice.close).where(*conditions).order_by(BenchmarkPrice.date)).all()
    klse: dict[str, float] = {}
    gspc: dict[str, float] = {}
    for row in rows:
        (klse if row.symbol == BURSA_BENCHMARK else gspc)[date_key(row.date)] = float(row.close)
    out = Aligned([], [], [])
    for point in portfolio_series:
        k = klse.get(point["date"])
        g = gspc.get(point["date"])
        if weights["bursa"] > 0 and k is None:
            continue
        if weights["us"] > 0 and g is None:
            continue
        out.p_series.append(point)
        out.k_series.append({"date": point["date"], "value": k if k is not None else 1})
        out.g_series.append({"date": point["date"], "value": g if g is not None else 1})
    return out


def _benchmark_levels(db: Session, dates: list[str], us_benchmark: str) -> tuple[list[DailyValue], list[DailyValue]]:
    rows = db.execute(
        select(BenchmarkPrice.symbol, BenchmarkPrice.date, BenchmarkPrice.close)
        .where(BenchmarkPrice.symbol.in_([BURSA_BENCHMARK, us_benchmark]))
        .order_by(BenchmarkPrice.date)
    ).all()
    klci_points: list[SeriesPoint] = [{"date": day_ms(r.date), "close": float(r.close)} for r in rows if r.symbol == BURSA_BENCHMARK]
    spx_points: list[SeriesPoint] = [{"date": day_ms(r.date), "close": float(r.close)} for r in rows if r.symbol == us_benchmark]
    klci: list[DailyValue] = []
    spx: list[DailyValue] = []
    last_klci: float | None = None
    last_spx: float | None = None
    for key in dates:
        time = day_ms(parse_date(key))
        found = latest_at_or_before(klci_points, time)
        last_klci = found if found is not None else last_klci
        found = latest_at_or_before(spx_points, time)
        last_spx = found if found is not None else last_spx
        if last_klci is not None:
            klci.append({"date": key, "value": last_klci})
        if last_spx is not None:
            spx.append({"date": key, "value": last_spx})
    return klci, spx


def _realized_totals(db: Session, portfolio_id: str, base_currency: str) -> dict[str, float]:
    sells, lots = realize_portfolio(db, portfolio_id, base_currency)
    realized = sum(row["realizedPnLBase"] for row in sells.values())
    cost = sum(row["costBase"] for row in sells.values())
    return {"realizedPnL": realized, "realizedPnLPct": realized / cost if cost > 0 else 0, "closedLotCount": len(lots)}


def get_summary(db: Session, portfolio_id: str, user_id: str) -> dict[str, Any]:
    portfolio = get_owned_portfolio(db, portfolio_id, user_id)
    base = portfolio.base_currency.value
    priced = [mark for mark in mark_open_positions(db, portfolio_id, base) if mark.market_value is not None]
    snapshots = db.scalars(
        select(PortfolioSnapshot).where(PortfolioSnapshot.portfolio_id == portfolio_id).order_by(PortfolioSnapshot.date.desc()).limit(8)
    ).all()
    realized = _realized_totals(db, portfolio_id, base)
    head = {"portfolioId": portfolio_id, "name": portfolio.name, "baseCurrency": portfolio.base_currency}

    if not priced:
        if not snapshots:
            return {
                **head,
                "totalValue": 0,
                "totalCost": 0,
                "unrealizedPnL": 0,
                "unrealizedPnLPct": 0,
                "realizedPnL": realized["realizedPnL"],
                "realizedPnLPct": realized["realizedPnLPct"],
                "totalPnL": realized["realizedPnL"],
                "closedLotCount": realized["closedLotCount"],
                "todayReturnPct": 0,
                "todayReturnValue": 0,
                "asOfDate": None,
            }
        current = snapshots[0]
        total_value = float(current.total_value)
        total_cost = float(current.total_cost)
        prev_value = float(snapshots[1].total_value) if len(snapshots) > 1 else total_value
        unrealized = total_value - total_cost
        return {
            **head,
            "totalValue": total_value,
            "totalCost": total_cost,
            "unrealizedPnL": unrealized,
            "unrealizedPnLPct": unrealized / total_cost if total_cost > 0 else 0,
            "realizedPnL": realized["realizedPnL"],
            "realizedPnLPct": realized["realizedPnLPct"],
            "totalPnL": unrealized + realized["realizedPnL"],
            "closedLotCount": realized["closedLotCount"],
            "todayReturnPct": (total_value - prev_value) / prev_value if prev_value > 0 else 0,
            "todayReturnValue": total_value - prev_value,
            "asOfDate": date_key(current.date),
        }

    total_value = sum(mark.market_value for mark in priced)  # type: ignore[misc]
    total_cost = sum(mark.base_cost for mark in priced)
    as_of: str | None = None
    for mark in priced:
        if mark.last_price_date is None:
            continue
        key = date_key(mark.last_price_date)
        if as_of is None or key > as_of:
            as_of = key
    as_of_time = day_ms(parse_date(as_of)) if as_of else None
    prev = next((s for s in snapshots if as_of_time is None or day_ms(s.date) < as_of_time), None)
    prev_value = float(prev.total_value) if prev else total_value
    unrealized = total_value - total_cost
    return {
        **head,
        "totalValue": total_value,
        "totalCost": total_cost,
        "unrealizedPnL": unrealized,
        "unrealizedPnLPct": unrealized / total_cost if total_cost > 0 else 0,
        "realizedPnL": realized["realizedPnL"],
        "realizedPnLPct": realized["realizedPnLPct"],
        "totalPnL": unrealized + realized["realizedPnL"],
        "closedLotCount": realized["closedLotCount"],
        "todayReturnPct": (total_value - prev_value) / prev_value if prev_value > 0 else 0,
        "todayReturnValue": total_value - prev_value,
        "asOfDate": as_of,
    }


def get_metrics(db: Session, portfolio_id: str, user_id: str, range_: str) -> dict[str, Any]:
    portfolio = get_owned_portfolio(db, portfolio_id, user_id)
    base = portfolio.base_currency.value
    rows = load_snapshots(db, portfolio_id, range_)
    if len(rows) < 3:
        raise AppError(422, "INSUFFICIENT_DATA", "Not enough snapshot data for this range - run a sync and try again")

    # Risk describes the strategy, not the funding: everything runs on the
    # cash-flow adjusted, dividend-inclusive series.
    twr = build_twr_series(db, portfolio_id, base, rows)
    daily = to_daily_returns(twr)
    rf = settings.RISK_FREE_RATE
    portfolio_annual = annualized_return(daily)
    years = (day_ms(parse_date(rows[-1].date)) - day_ms(parse_date(rows[0].date))) / YEAR_MS

    weights = get_benchmark_weights(db, portfolio_id, base)
    us_benchmark = resolve_us_benchmark(db)
    aligned = load_aligned_benchmark(db, twr, weights, range_, us_benchmark)
    beta_value = 0.0
    alpha_value = 0.0
    if len(aligned.p_series) >= 3:
        p_returns = to_daily_returns(aligned.p_series)
        bench = composite_benchmark_returns(to_daily_returns(aligned.k_series), to_daily_returns(aligned.g_series), weights["bursa"], weights["us"])
        beta_value = beta(p_returns, bench)
        alpha_value = alpha(portfolio_annual, annualized_return(bench), rf, beta_value)

    return {
        "range": range_,
        "asOf": rows[-1].date,
        "annualReturn": portfolio_annual,
        "cagr": cagr(twr[0]["value"], twr[-1]["value"], years),
        "volatility": volatility(daily),
        "sharpeRatio": sharpe_ratio(daily, rf),
        "sharpeStandardError": sharpe_standard_error(daily, rf),
        "beta": beta_value,
        "alpha": alpha_value,
        "maxDrawdown": max_drawdown(twr),
        "intervals": stationary_bootstrap(
            daily,
            {
                "sharpe": lambda sample: sharpe_ratio(sample, rf),
                "cagr": lambda sample: cagr_from_returns(sample, years),
                "maxDrawdown": max_drawdown_from_returns,
            },
        ),
        "dividendIncome": sum(row.income for row in rows),
        "observations": len(daily),
        "isLowConfidence": len(daily) < LOW_CONFIDENCE_OBSERVATIONS,
        "usBenchmark": us_benchmark,
    }


def get_performance(db: Session, portfolio_id: str, user_id: str, range_: str) -> dict[str, Any]:
    portfolio = get_owned_portfolio(db, portfolio_id, user_id)
    base = portfolio.base_currency.value
    rows = load_snapshots(db, portfolio_id, range_)
    if not rows:
        return {"range": range_, "series": [], "benchmarkSeries": [], "klciSeries": [], "spxSeries": [], "usBenchmark": resolve_us_benchmark(db)}
    nav = _nav(rows)
    weights = get_benchmark_weights(db, portfolio_id, base)
    us_benchmark = resolve_us_benchmark(db)
    aligned = load_aligned_benchmark(db, nav, weights, range_, us_benchmark)
    klci, spx = _benchmark_levels(db, [point["date"] for point in nav], us_benchmark)
    series = build_twr_series(db, portfolio_id, base, rows)

    benchmark_series: list[dict[str, Any]] = []
    if len(aligned.p_series) >= 2:
        bench = composite_benchmark_returns(to_daily_returns(aligned.k_series), to_daily_returns(aligned.g_series), weights["bursa"], weights["us"])
        indexed = 100.0
        benchmark_series.append({"date": aligned.p_series[0]["date"], "indexedValue": 100})
        for i, ret in enumerate(bench):
            indexed *= 1 + ret
            benchmark_series.append({"date": aligned.p_series[i + 1]["date"], "indexedValue": indexed})

    return {
        "range": range_,
        "series": series,
        "benchmarkSeries": benchmark_series,
        "klciSeries": index_to_100(klci),
        "spxSeries": index_to_100(spx),
        "usBenchmark": us_benchmark,
    }


def get_allocation(db: Session, portfolio_id: str, user_id: str) -> dict[str, Any]:
    portfolio = get_owned_portfolio(db, portfolio_id, user_id)
    priced = [mark for mark in mark_open_positions(db, portfolio_id, portfolio.base_currency.value) if mark.market_value is not None]
    total = sum(mark.market_value for mark in priced)  # type: ignore[misc]
    items: list[dict[str, Any]] = [
        {
            "symbol": mark.symbol,
            "exchange": mark.exchange,
            "marketValue": mark.market_value,
            "percentage": mark.market_value / total if total > 0 else 0,  # type: ignore[operator]
        }
        for mark in priced
    ]
    items.sort(key=lambda item: item["marketValue"], reverse=True)
    return {"totalValue": total, "items": items}


def get_price_series(db: Session, portfolio_id: str, user_id: str, raw_symbol: str, range_: str) -> dict[str, Any]:
    get_owned_portfolio(db, portfolio_id, user_id)
    symbol = raw_symbol.upper()
    in_portfolio = db.scalars(select(Holding.id).where(Holding.portfolio_id == portfolio_id, Holding.symbol == symbol).limit(1)).first() or db.scalars(
        select(Transaction.id).where(Transaction.portfolio_id == portfolio_id, Transaction.symbol == symbol).limit(1)
    ).first()
    if not in_portfolio:
        raise AppError(404, "NOT_FOUND", "Symbol not found in this portfolio")
    start = resolve_range_start(range_)
    conditions = [DailyPrice.symbol == symbol]
    if start:
        conditions.append(DailyPrice.date >= start)
    prices = db.execute(select(DailyPrice.date, DailyPrice.close, DailyPrice.currency).where(*conditions).order_by(DailyPrice.date)).all()
    return {
        "symbol": symbol,
        "currency": prices[0].currency if prices else currency_from_symbol(symbol),
        "range": range_,
        "series": [{"date": date_key(row.date), "close": float(row.close)} for row in prices],
    }


def load_risk_path(db: Session, portfolio_id: str, user_id: str, range_: str) -> dict[str, Any]:
    """Time-weighted path plus the benchmark aligned to it. Used by the risk book."""
    portfolio = get_owned_portfolio(db, portfolio_id, user_id)
    base = portfolio.base_currency.value
    rows = load_snapshots(db, portfolio_id, range_)
    weights = get_benchmark_weights(db, portfolio_id, base)
    us_benchmark = resolve_us_benchmark(db)
    if len(rows) < 2:
        return {"baseCurrency": portfolio.base_currency, "twr": [], "weights": weights, "usBenchmark": us_benchmark, "aligned": Aligned([], [], [])}
    twr = build_twr_series(db, portfolio_id, base, rows)
    return {
        "baseCurrency": portfolio.base_currency,
        "twr": twr,
        "weights": weights,
        "usBenchmark": us_benchmark,
        "aligned": load_aligned_benchmark(db, twr, weights, range_, us_benchmark),
    }
