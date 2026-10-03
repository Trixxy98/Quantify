from typing import Any

from app.services import corporate_actions, fx, lots, metrics, stats
from app.services.corporate_actions import SplitRow
from tests.fixtures_util import check_module


def _splits(rows: list[dict[str, Any]]) -> list[SplitRow]:
    return [SplitRow(row["date"], row["numerator"], row["denominator"]) for row in rows]


def _replay(trades: list[dict[str, Any]], splits: dict[str, list[dict[str, Any]]], usd_myr: list[Any], base: str) -> dict:
    parsed = [
        lots.LotTrade(
            id=t["id"],
            symbol=t["symbol"],
            type=t["type"],
            quantity=t["quantity"],
            price=t["price"],
            fee=t["fee"],
            date=t["date"],
            created_at=t["createdAt"],
            currency=t["currency"],
        )
        for t in trades
    ]
    sells, closed = lots.replay_realized(
        parsed,
        {symbol: _splits(rows) for symbol, rows in splits.items()},
        lambda value, from_, time: fx.to_base(value, from_, base, usd_myr, time),
    )
    return {"sells": list(sells.values()), "lots": closed}


REGISTRY = {
    "stats.average": stats.average,
    "stats.variance": stats.variance,
    "stats.stdDev": stats.std_dev,
    "stats.covariance": stats.covariance,
    "metrics.toDailyReturns": metrics.to_daily_returns,
    "metrics.todayReturn": metrics.today_return,
    "metrics.annualizedReturn": metrics.annualized_return,
    "metrics.volatility": metrics.volatility,
    "metrics.sharpeRatio": metrics.sharpe_ratio,
    "metrics.sharpeStandardError": metrics.sharpe_standard_error,
    "metrics.maxDrawdownFromReturns": metrics.max_drawdown_from_returns,
    "metrics.cagrFromReturns": metrics.cagr_from_returns,
    "metrics.cagr": metrics.cagr,
    "metrics.beta": metrics.beta,
    "metrics.alpha": metrics.alpha,
    "metrics.maxDrawdown": metrics.max_drawdown,
    "metrics.compositeBenchmarkReturns": metrics.composite_benchmark_returns,
    "metrics.indexTo100": metrics.index_to_100,
    "metrics.timeWeightedIndex": metrics.time_weighted_index,
    "fx.fxBarDate": fx.fx_bar_date,
    "fx.isWeekendDate": fx.is_weekend_date,
    "fx.latestAtOrBefore": fx.latest_at_or_before,
    "fx.toBase": fx.to_base,
    "corporate.isRebased": corporate_actions.is_rebased,
    "corporate.splitFactorAfter": lambda splits, time: corporate_actions.split_factor_after(_splits(splits), time),
    "corporate.adjustTrade": lambda q, p, splits, time: corporate_actions.adjust_trade(q, p, _splits(splits), time),
    "lots.replayRealized": _replay,
}


def test_ledger_matches_typescript() -> None:
    check_module("ledger", REGISTRY)
