import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.errors import AppError
from app.models import BenchmarkPrice, DailyPrice, FactorReturn, Transaction
from app.research.bootstrap import BOOTSTRAP_BLOCK_LENGTH, BOOTSTRAP_RESAMPLES, stationary_bootstrap
from app.research.french import FACTOR_NAMES
from app.research.momentum import momentum_conclusion, run_momentum
from app.research.ols import ols
from app.services.corporate_actions import load_dividends
from app.services.market import sync_daily_prices
from app.services.metrics import (
    DailyValue,
    annualized_return,
    max_drawdown,
    sharpe_ratio,
    sharpe_standard_error,
    volatility,
)
from app.services.portfolio import get_owned_portfolio
from app.timeutil import date_key

log = logging.getLogger("quantify")
BASKET = json.loads((Path(__file__).resolve().parents[1] / "data" / "momentumBasket.json").read_text())
MIN_BARS = 400
HISTORY_FROM = datetime(2015, 1, 1)
BENCHMARK = "^SP500TR"
PRICE_BENCHMARK = "^GSPC"

_inflight: dict[str, threading.Event] = {}
_inflight_lock = threading.Lock()


def ensure_history(db: Session, symbols: list[str]) -> list[str]:
    """Fetches history from 2015 for any symbol with fewer than MIN_BARS stored. Returns the ones that failed."""
    counts = dict(db.execute(select(DailyPrice.symbol, func.count()).where(DailyPrice.symbol.in_(symbols)).group_by(DailyPrice.symbol)).all())
    thin = [symbol for symbol in symbols if counts.get(symbol, 0) < MIN_BARS]
    failed: list[str] = []

    def work(symbol: str) -> None:
        with _inflight_lock:
            pending = _inflight.get(symbol)
            if pending is None:
                done = threading.Event()
                _inflight[symbol] = done
        if pending is not None:
            pending.wait()
            return
        try:
            with SessionLocal() as own:
                sync_daily_prices(own, symbol, HISTORY_FROM)
        except Exception:
            log.exception("[momentum] price sync failed %s", symbol)
            failed.append(symbol)
        finally:
            with _inflight_lock:
                _inflight.pop(symbol, None)
            done.set()

    if thin:
        with ThreadPoolExecutor(max_workers=min(3, len(thin))) as pool:
            list(pool.map(work, thin))
    return failed


def build_level(closes: list[dict[str, Any]], dividends: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Total-return index: closes with dividends reinvested on the ex-date."""
    if not closes:
        return []
    income = {row["date"]: row["amount"] for row in dividends}
    level = 100.0
    out = [{"date": closes[0]["date"], "level": level}]
    for i in range(1, len(closes)):
        prev = closes[i - 1]["close"]
        if prev > 0:
            level *= (closes[i]["close"] + income.get(closes[i]["date"], 0)) / prev
        out.append({"date": closes[i]["date"], "level": level})
    return out


def _align(series: list[list[dict[str, Any]]]) -> tuple[list[str], list[list[float]]]:
    start = max(row[0]["date"] for row in series)
    dates = sorted({point["date"] for row in series for point in row if point["date"] >= start})
    levels = []
    for row in series:
        out = []
        cursor = 0
        last = row[0]["level"]
        for day in dates:
            while cursor < len(row) and row[cursor]["date"] <= day:
                last = row[cursor]["level"]
                cursor += 1
            out.append(last)
        levels.append(out)
    return dates, levels


def _stats(returns: list[float], monthly: list[float], turnovers: list[float] | None) -> dict[str, Any]:
    rf = settings.RISK_FREE_RATE
    equity: list[DailyValue] = []
    value = 100.0
    for index, ret in enumerate(returns):
        value *= 1 + ret
        equity.append({"date": str(index), "value": value})
    turnover_total = 0.0
    for t in turnovers or []:
        turnover_total += t
    return {
        "annualizedReturn": annualized_return(returns),
        "volatility": volatility(returns),
        "sharpe": sharpe_ratio(returns, rf),
        "sharpeSe": sharpe_standard_error(returns, rf),
        "sharpeInterval": stationary_bootstrap(returns, {"sharpe": lambda sample: sharpe_ratio(sample, rf)})["sharpe"],
        "maxDrawdown": max_drawdown(equity),
        "hitRate": None if not monthly else len([r for r in monthly if r > 0]) / len(monthly),
        "avgTurnover": None if turnovers is None or not turnovers else turnover_total / len(turnovers),
    }


def _monthly(days: list[dict[str, Any]], key: str) -> list[float]:
    groups: dict[str, float] = {}
    for day in days:
        month = day["date"][:7]
        groups[month] = groups.get(month, 1.0) * (1 + day[key])
    return [growth - 1 for growth in groups.values()]


def _rolling_excess(days: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for end in range(252, len(days) + 1):
        strategy = 1.0
        buy_hold = 1.0
        for i in range(end - 252, end):
            strategy *= 1 + days[i]["strategy"]
            buy_hold *= 1 + days[i]["buyHold"]
        out.append({"date": days[end - 1]["date"], "value": strategy - buy_hold})
    return out


def _equity_curve(days: list[dict[str, Any]], bench: list[float | None]) -> list[dict[str, Any]]:
    strategy = buy_hold = equal = benchmark = 100.0
    known = False
    out = []
    for index, day in enumerate(days):
        strategy *= 1 + day["strategy"]
        buy_hold *= 1 + day["buyHold"]
        equal *= 1 + day["equalWeight"]
        ret = bench[index]
        if ret is not None:
            benchmark *= 1 + ret
            known = True
        out.append({"date": day["date"], "strategy": strategy, "buyHold": buy_hold, "equalWeight": equal, "benchmark": benchmark if known else None})
    return out


def _benchmark_returns(db: Session, dates: list[str]) -> dict[str, Any] | None:
    has_tr = db.scalar(select(func.count()).select_from(BenchmarkPrice).where(BenchmarkPrice.symbol == BENCHMARK)) or 0
    symbol = BENCHMARK if has_tr > 0 else PRICE_BENCHMARK
    rows = db.execute(
        select(BenchmarkPrice.date, BenchmarkPrice.close)
        .where(BenchmarkPrice.symbol == symbol, BenchmarkPrice.date >= datetime.fromisoformat(dates[0]).date())
        .order_by(BenchmarkPrice.date)
    ).all()
    if len(rows) < 2:
        return None
    ordered = sorted({date_key(row.date): float(row.close) for row in rows}.items())
    cursor = 0
    prev: float | None = None
    out: list[float | None] = []
    for day in dates:
        while cursor < len(ordered) and ordered[cursor][0] < day:
            prev = ordered[cursor][1]
            cursor += 1
        if cursor < len(ordered) and ordered[cursor][0] == day and prev is not None and prev > 0:
            out.append(ordered[cursor][1] / prev - 1)
            prev = ordered[cursor][1]
            cursor += 1
        else:
            out.append(None)
    return {"symbol": symbol, "returns": out}


def _factor_alpha(db: Session, days: list[dict[str, Any]]) -> dict[str, Any] | None:
    rows = db.execute(
        select(FactorReturn.date, FactorReturn.factor, FactorReturn.value)
        .where(FactorReturn.date >= datetime.fromisoformat(days[0]["date"]).date(), FactorReturn.date <= datetime.fromisoformat(days[-1]["date"]).date())
        .order_by(FactorReturn.date)
    ).all()
    by_date: dict[str, dict[str, float]] = {}
    for row in rows:
        by_date.setdefault(date_key(row.date), {})[row.factor] = float(row.value)
    y: list[float] = []
    x: list[list[float]] = []
    for day in days:
        factors = by_date.get(day["date"])
        if not factors:
            continue
        rf = factors.get("RF")
        regressors = [factors.get(name) for name in FACTOR_NAMES]
        if rf is None or any(value is None for value in regressors):
            continue
        y.append(day["strategy"] - rf)
        x.append(regressors)  # type: ignore[arg-type]
    if len(y) <= len(FACTOR_NAMES) + 1:
        return None
    fit = ols(y, x, 5)
    return {"annualized": fit["beta"][0] * 252, "se": fit["se"][0] * 252, "tStat": fit["tStat"][0], "n": fit["n"]}


def get_momentum_study(
    db: Session, user_id: str, portfolio_id: str | None, universe: str, commission_bps: float, slippage_bps: float, allow_short: bool
) -> dict[str, Any]:
    notes = [
        "12-1 momentum, rebalanced monthly, long the top third. The rank uses the close twelve months before formation over the close one month before it. Nothing in the holding month is an input, and the rule has no fitted parameter.",
        f"Costs are {_num(commission_bps)} bps commission plus {_num(slippage_bps)} bps slippage on the sum of absolute weight changes. Entering from cash costs one unit; replacing the book costs two.",
        f"Sharpe uses a constant {settings.RISK_FREE_RATE * 100:.1f}% risk-free rate. The factor alpha subtracts Ken French's daily RF and uses Newey–West standard errors.",
        f"Sharpe intervals are the 5th–95th percentile of {BOOTSTRAP_RESAMPLES} stationary block bootstrap resamples (mean block {BOOTSTRAP_BLOCK_LENGTH} sessions) of the out-of-sample daily returns. They keep volatility clustering that the ± SE ignores.",
    ]
    basket_as_of = None
    if universe == "basket":
        symbols = list(BASKET["symbols"])
        basket_as_of = BASKET["asOf"]
        notes.append(BASKET["note"])
        notes.append(
            "The list is applied back through 2015, so it contains companies that were not large then. Momentum and buy-and-hold share that list, which makes their comparison fair. The gap versus the S&P does not have that excuse."
        )
    else:
        if not portfolio_id:
            raise AppError(400, "VALIDATION_ERROR", "portfolioId is required for the holdings universe.")
        get_owned_portfolio(db, portfolio_id, user_id)
        traded = db.scalars(select(Transaction.symbol).where(Transaction.portfolio_id == portfolio_id).distinct()).all()
        symbols = sorted(symbol for symbol in traded if "." not in symbol)
        notes.append("Holdings universe: US names in this portfolio. Bursa names are excluded.")

    base: dict[str, Any] = {
        "universe": universe,
        "basketAsOf": basket_as_of,
        "symbols": symbols,
        "allowShort": allow_short,
        "commissionBps": commission_bps,
        "slippageBps": slippage_bps,
        "longCount": 0,
        "shortCount": 0,
        "latestLong": [],
        "conclusion": "Not enough history to form a 12-1 book.",
        "from": None,
        "to": None,
        "n": 0,
        "strategy": None,
        "buyHold": None,
        "equalWeight": None,
        "benchmark": None,
        "benchmarkSymbol": None,
        "alpha": None,
        "equity": [],
        "excess": [],
        "turnover": [],
        "notes": notes,
    }
    if not symbols:
        notes.append("No US symbols in this universe.")
        return base

    failed = ensure_history(db, symbols)
    if failed:
        notes.append(f"No price history for {', '.join(failed)}.")
    usable = [symbol for symbol in symbols if symbol not in failed]
    prices = db.execute(select(DailyPrice.symbol, DailyPrice.date, DailyPrice.close).where(DailyPrice.symbol.in_(usable)).order_by(DailyPrice.date)).all()
    dividends = load_dividends(db, usable)
    closes_by: dict[str, list[dict[str, Any]]] = {}
    for row in prices:
        closes_by.setdefault(row.symbol, []).append({"date": date_key(row.date), "close": float(row.close)})
    ready = [symbol for symbol in usable if len(closes_by.get(symbol, [])) >= MIN_BARS]
    dropped = [symbol for symbol in usable if symbol not in ready]
    if dropped:
        notes.append(f"Dropped {', '.join(dropped)}: fewer than {MIN_BARS} sessions.")
    if not ready:
        return {**base, "symbols": [], "notes": notes}

    paired = [
        {
            "symbol": symbol,
            "level": build_level(closes_by.get(symbol, []), [{"date": date_key(row.ex_date), "amount": row.amount} for row in dividends.get(symbol, [])]),
        }
        for symbol in ready
    ]
    paired = [row for row in paired if row["level"]]
    if not paired:
        return {**base, "symbols": [], "notes": notes}
    dates, levels = _align([row["level"] for row in paired])
    names = [row["symbol"] for row in paired]
    run = run_momentum(dates, names, levels, allow_short, commission_bps, slippage_bps)
    if not run.days:
        notes.append("Need 14 months of overlapping prices before the first out-of-sample month.")
        return {**base, "symbols": names, "notes": notes}

    bench = _benchmark_returns(db, [day["date"] for day in run.days])
    bench_rets: list[float | None] = bench["returns"] if bench else [None] * len(run.days)
    bench_only = [ret for ret in bench_rets if ret is not None]
    try:
        alpha = _factor_alpha(db, run.days)
    except Exception:
        log.exception("[momentum] factor alpha failed")
        alpha = None
    if not alpha:
        notes.append("Factor alpha needs the Ken French table. Run uv run python scripts/refresh_factors.py.")
    elif alpha["n"] < 120:
        notes.append(f"Factor alpha is fit on {alpha['n']} sessions, under the 120 used on the Factors page.")
    if bench and bench["symbol"] == PRICE_BENCHMARK:
        notes.append("S&P comparison is the price index; sync ^SP500TR for the total-return version.")
    if allow_short:
        notes.append("The short book is the bottom third, sized so the longs and shorts each carry half the gross.")

    strategy = _stats([d["strategy"] for d in run.days], [m["strategy"] for m in run.months], [m["turnover"] for m in run.months])
    benchmark = None
    if bench and len(bench_only) > 20:
        filled = [ret if ret is not None else 0 for ret in bench_rets]
        benchmark = _stats(filled, _monthly([{**day, "buyHold": filled[i]} for i, day in enumerate(run.days)], "buyHold"), None)

    return {
        **base,
        "symbols": names,
        "longCount": run.long_count,
        "shortCount": run.short_count,
        "latestLong": run.latest_long,
        "conclusion": momentum_conclusion(strategy["annualizedReturn"], annualized_return([d["buyHold"] for d in run.days]), len(run.days), len(names)),
        "from": run.days[0]["date"],
        "to": run.days[-1]["date"],
        "n": len(run.days),
        "strategy": strategy,
        "buyHold": _stats([d["buyHold"] for d in run.days], _monthly(run.days, "buyHold"), None),
        "equalWeight": _stats([d["equalWeight"] for d in run.days], _monthly(run.days, "equalWeight"), None),
        "benchmark": benchmark,
        "benchmarkSymbol": bench["symbol"] if bench else None,
        "alpha": alpha,
        "equity": _equity_curve(run.days, bench_rets),
        "excess": _rolling_excess(run.days),
        "turnover": [{"month": m["month"], "turnover": m["turnover"]} for m in run.months],
        "notes": notes,
    }


def _num(value: float) -> str:
    """A number as a JS template literal prints it."""
    return str(int(value)) if value == int(value) else repr(value)
