import math
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BenchmarkPrice, DailyPrice, Exchange
from app.services.dashboard import load_risk_path
from app.services.date_range import resolve_range_start
from app.services.fx import SeriesPoint, latest_at_or_before
from app.services.metrics import (
    annualized_return,
    composite_benchmark_returns,
    max_drawdown,
    to_daily_returns,
    volatility,
)
from app.services.risk_math import (
    annualized_vol_from_daily_variances,
    correlation_matrix,
    drawdown_episodes,
    expected_shortfall,
    garman_klass_daily,
    kupiec_statistic,
    portfolio_risk,
    quantile,
    rolling_vol_beta,
    sample_covariance_matrix,
    ulcer_index,
)
from app.services.stats import covariance, std_dev, variance
from app.services.valuation import OpenPositionMark, mark_open_positions
from app.timeutil import date_key, day_ms

BURSA_BENCHMARK = "^KLSE"
ANN = math.sqrt(252)
MIN_OVERLAP = 20
ROLLING = 60
VAR_P = 0.05
VAR_99 = 0.01


def _beta_to(stock: list[float], bench: list[float]) -> float | None:
    if len(stock) < MIN_OVERLAP:
        return None
    bench_var = variance(bench)
    if not math.isfinite(bench_var) or bench_var < 1e-18:
        return None
    return covariance(stock, bench) / bench_var


def get_risk(db: Session, portfolio_id: str, user_id: str, range_: str, window: int = 60) -> dict[str, Any]:
    path = load_risk_path(db, portfolio_id, user_id, range_)
    marks = mark_open_positions(db, portfolio_id, path["baseCurrency"].value)
    priced = [mark for mark in marks if mark.market_value is not None and mark.market_value > 0]
    total_value = 0.0
    for mark in priced:
        total_value += mark.market_value  # type: ignore[operator]

    twr = path["twr"]
    twr_returns = to_daily_returns(twr)
    max_dd = max_drawdown(twr) if len(twr) > 1 else 0
    annual = annualized_return(twr_returns) if twr_returns else 0

    peak = twr[0]["value"] if twr else 0
    underwater = []
    for point in twr:
        if point["value"] > peak:
            peak = point["value"]
        underwater.append({"date": point["date"], "drawdown": (point["value"] - peak) / peak if peak > 0 else 0})

    aligned = path["aligned"]
    bench_returns = composite_benchmark_returns(
        to_daily_returns(aligned.k_series), to_daily_returns(aligned.g_series), path["weights"]["bursa"], path["weights"]["us"]
    )
    bench_dates = [point["date"] for point in aligned.p_series[1:]]
    aligned_port = to_daily_returns(aligned.p_series)

    notes = [
        "Volatility, VaR and drawdowns use the time-weighted, dividend-inclusive portfolio path. Deposits are not gains.",
        "Risk share uses today's weights times the covariance of sessions where every held name traded. Shares sum to 100% of that volatility.",
        "Garman–Klass uses the high, low, open and close. Close-to-close is shown beside it because the risk shares are still close-to-close.",
    ]
    if len(twr_returns) < 60:
        notes.append(f"Only {len(twr_returns)} daily portfolio returns in this range. Treat VaR and Sharpe-style ratios as estimates.")

    names = _name_risk(db, priced, total_value, range_, notes)

    kupiec_window = min(ROLLING, max(len(twr_returns) - 1, 0))
    breaches = 0
    trials = 0
    if len(twr_returns) > ROLLING:
        for i in range(ROLLING, len(twr_returns)):
            threshold = quantile(twr_returns[i - ROLLING : i], VAR_P)
            trials += 1
            if twr_returns[i] <= threshold:
                breaches += 1

    enough = len(twr_returns) >= MIN_OVERLAP
    return {
        "range": range_,
        "asOf": twr[-1]["date"] if twr else None,
        "baseCurrency": path["baseCurrency"],
        "observations": len(twr_returns),
        "isLowConfidence": len(twr_returns) < 60,
        "usBenchmark": path["usBenchmark"],
        "notes": notes,
        "path": {
            "volatility": volatility(twr_returns) if len(twr_returns) > 1 else 0,
            "maxDrawdown": max_dd,
            "calmar": annual / abs(max_dd) if max_dd < 0 else None,
            "ulcer": ulcer_index([point["value"] for point in twr]),
            "var95": quantile(twr_returns, VAR_P) if enough else None,
            "var99": quantile(twr_returns, VAR_99) if enough else None,
            "es95": expected_shortfall(twr_returns, VAR_P) if enough else None,
            "es99": expected_shortfall(twr_returns, VAR_99) if enough else None,
            "kupiec": (
                {
                    "p": VAR_P,
                    "window": kupiec_window,
                    "trials": trials,
                    "breaches": breaches,
                    "expected": trials * VAR_P,
                    **(kupiec_statistic(breaches, trials, VAR_P) or {}),
                }
                if trials >= MIN_OVERLAP
                else None
            ),
        },
        "names": names["rows"],
        "correlation": names["correlation"],
        "underwater": underwater,
        "rolling": rolling_vol_beta(aligned_port, bench_returns, bench_dates, window),
        "drawdowns": drawdown_episodes(twr),
    }


def _name_risk(db: Session, priced: list[OpenPositionMark], total_value: float, range_: str, notes: list[str]) -> dict[str, Any]:
    if not priced or total_value <= 0:
        return {"rows": [], "correlation": {"symbols": [], "matrix": []}}

    symbols = [mark.symbol for mark in priced]
    start = resolve_range_start(range_)
    start_key = date_key(start) if start else None
    prices = db.execute(
        select(DailyPrice.symbol, DailyPrice.date, DailyPrice.open, DailyPrice.high, DailyPrice.low, DailyPrice.close)
        .where(DailyPrice.symbol.in_(symbols))
        .order_by(DailyPrice.date)
    ).all()
    benchmarks = db.execute(
        select(BenchmarkPrice.symbol, BenchmarkPrice.date, BenchmarkPrice.close)
        .where(BenchmarkPrice.symbol.in_([BURSA_BENCHMARK, "^GSPC", "^SP500TR"]))
        .order_by(BenchmarkPrice.date)
    ).all()

    by_symbol: dict[str, list[dict[str, Any]]] = {}
    for row in prices:
        by_symbol.setdefault(row.symbol, []).append(
            {
                "date": date_key(row.date),
                "time": day_ms(row.date),
                "open": float(row.open),
                "high": float(row.high),
                "low": float(row.low),
                "close": float(row.close),
            }
        )
    klci: list[SeriesPoint] = []
    spx: list[SeriesPoint] = []
    for bench_row in benchmarks:
        point: SeriesPoint = {"date": day_ms(bench_row.date), "close": float(bench_row.close)}
        if bench_row.symbol == BURSA_BENCHMARK:
            klci.append(point)
        elif bench_row.symbol == "^GSPC":
            spx.append(point)

    usable = [symbol for symbol in symbols if len(by_symbol.get(symbol, [])) > 1]
    date_sets = [{bar["date"] for bar in by_symbol.get(symbol, [])} for symbol in usable]
    overlap = sorted(day for day in (date_sets[0] if date_sets else set()) if all(day in s for s in date_sets))

    def in_range(day: str) -> bool:
        return start_key is None or day >= start_key

    position = {day: index for index, day in enumerate(overlap)}
    return_dates = [day for index, day in enumerate(overlap) if index > 0 and in_range(day)]
    columns = []
    for symbol in usable:
        closes = {bar["date"]: bar["close"] for bar in by_symbol.get(symbol, [])}
        column = []
        for day in return_dates:
            prev = closes[overlap[position[day] - 1]]
            curr = closes[day]
            column.append((curr - prev) / prev if prev > 0 else 0)
        columns.append(column)

    mark_by_symbol = {mark.symbol: mark for mark in priced}
    weights = [mark_by_symbol[symbol].market_value / total_value for symbol in usable]  # type: ignore[operator]
    weight_sum = 0.0
    for weight in weights:
        weight_sum += weight
    weight_sum = weight_sum or 1
    scaled = [weight / weight_sum for weight in weights]

    enough = bool(columns) and len(columns[0]) >= MIN_OVERLAP
    cov = sample_covariance_matrix(columns) if enough else []
    parts = portfolio_risk(scaled, cov) if enough else None
    corr = correlation_matrix(cov) if enough else []
    if not enough:
        notes.append("Not enough sessions where every holding traded together, so correlation and risk shares are withheld.")

    rows = []
    for index, symbol in enumerate(usable):
        bars = by_symbol.get(symbol, [])
        gk = [
            value
            for bar in bars
            if in_range(bar["date"])
            for value in [garman_klass_daily(bar["open"], bar["high"], bar["low"], bar["close"])]
            if value is not None
        ]
        own: list[float] = []
        bench_returns: list[float] = []
        bench = klci if mark_by_symbol[symbol].exchange == Exchange.BURSA else spx
        for i in range(1, len(bars)):
            if not in_range(bars[i]["date"]) or not (bars[i - 1]["close"] > 0):
                continue
            b0 = latest_at_or_before(bench, bars[i - 1]["time"])
            b1 = latest_at_or_before(bench, bars[i]["time"])
            if b0 is None or b1 is None or not (b0 > 0):
                continue
            own.append((bars[i]["close"] - bars[i - 1]["close"]) / bars[i - 1]["close"])
            bench_returns.append((b1 - b0) / b0)
        rows.append(
            {
                "symbol": symbol,
                "weight": scaled[index],
                "closeToCloseVol": std_dev(columns[index]) * ANN if len(columns[index]) > 1 else 0,
                "gkVol": annualized_vol_from_daily_variances(gk),
                "beta": _beta_to(own, bench_returns),
                "mctr": parts["mctr"][index] * ANN if parts else None,
                "cctr": parts["cctr"][index] * ANN if parts else None,
                "riskShare": parts["share"][index] if parts else None,
            }
        )
    rows.sort(key=lambda row: row["riskShare"] if row["riskShare"] is not None else -1, reverse=True)
    return {"rows": rows, "correlation": {"symbols": usable, "matrix": corr}}
