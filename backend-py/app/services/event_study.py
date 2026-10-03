import logging
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.errors import AppError
from app.research.bootstrap import BOOTSTRAP_MIN_CLUSTERS, BOOTSTRAP_RESAMPLES, Interval, cluster_bootstrap
from app.rows import locale_key
from app.services import yahoo
from app.services.events import resolve_event_dates
from app.services.stats import average, covariance, std_dev, variance
from app.timeutil import date_key, utcnow

log = logging.getLogger("quantify")
BURSA_BENCHMARK = "^KLSE"
US_BENCHMARK = "^GSPC"
# The market model is fitted on a window that stops well before the event so the event does not contaminate it.
ESTIMATION_LEN = 120
ESTIMATION_GAP = 21
MIN_ESTIMATION_OBS = 60
HISTOGRAM_BUCKETS = 15


@dataclass
class Bars:
    keys: list[str]
    close: list[float]
    ret: list[float | None]


def subtract_years(value: datetime, years: int) -> datetime:
    """Date.setUTCFullYear(y − n): 29 February rolls forward to 1 March."""
    try:
        return value.replace(year=value.year - years)
    except ValueError:
        return value.replace(year=value.year - years, month=3, day=1)


def _benchmark_for(symbols: list[str]) -> str:
    return BURSA_BENCHMARK if all(symbol.upper().endswith(".KL") for symbol in symbols) else US_BENCHMARK


def daily_closes(symbol: str, from_: datetime) -> tuple[list[str], list[float]]:
    """One close per UTC day, positive closes only, first bar of a day wins."""
    keys: list[str] = []
    closes: list[float] = []
    seen: set[str] = set()
    for bar in yahoo.chart(symbol, from_).quotes:
        if bar.close is None or not bar.close > 0:
            continue
        key = date_key(bar.date)
        if key in seen:
            continue
        seen.add(key)
        keys.append(key)
        closes.append(bar.close)
    return keys, closes


def _load_bars(symbol: str, from_: datetime) -> Bars:
    try:
        keys, close = daily_closes(symbol, from_)
    except Exception as err:
        log.exception("[events] chart fetch failed %s", symbol)
        raise AppError(502, "PRICE_UNAVAILABLE", f"Could not load price history for {symbol}.") from err
    ret: list[float | None] = [None if i == 0 else (price - close[i - 1]) / close[i - 1] for i, price in enumerate(close)]
    if len(keys) < ESTIMATION_LEN:
        raise AppError(422, "INSUFFICIENT_DATA", f"Not enough price history for {symbol} to fit a market model.")
    return Bars(keys, close, ret)


def percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return 0.0
    idx = (len(sorted_values) - 1) * p
    lo = math.floor(idx)
    hi = math.ceil(idx)
    if lo == hi:
        return sorted_values[lo]
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (idx - lo)


def _describe(values: list[float]) -> dict[str, float]:
    if not values:
        return {"n": 0, "mean": 0, "median": 0, "sd": 0, "p05": 0, "p95": 0, "hitRate": 0}
    ordered = sorted(values)
    return {
        "n": len(values),
        "mean": average(values),
        "median": percentile(ordered, 0.5),
        "sd": std_dev(values) if len(values) > 1 else 0,
        "p05": percentile(ordered, 0.05),
        "p95": percentile(ordered, 0.95),
        "hitRate": len([v for v in values if v > 0]) / len(values),
    }


def _market_model(stock: list[float], bench: list[float]) -> tuple[float, float] | None:
    if len(stock) < MIN_ESTIMATION_OBS:
        return None
    var_bench = variance(bench)
    if not math.isfinite(var_bench) or var_bench < 1e-12:
        return None
    beta = covariance(stock, bench) / var_bench
    if not math.isfinite(beta):
        return None
    return average(stock) - beta * average(bench), beta


def anchor_index(keys: list[str], key: str) -> int:
    """First trading day on or after the event date: day 0 of the study window."""
    lo, hi, found = 0, len(keys) - 1, -1
    while lo <= hi:
        mid = (lo + hi) >> 1
        if keys[mid] >= key:
            found = mid
            hi = mid - 1
        else:
            lo = mid + 1
    return found


def _max_drawdown(equity: list[float]) -> float:
    peak = -math.inf
    worst = 0.0
    for value in equity:
        peak = max(peak, value)
        if peak > 0:
            worst = min(worst, value / peak - 1)
    return worst


def _t_stat(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    sd = std_dev(values)
    if not math.isfinite(sd) or sd < 1e-12:
        return 0.0
    return average(values) / (sd / math.sqrt(len(values)))


def _histogram(event: list[float], baseline: list[float]) -> list[dict[str, float]]:
    if not event or not baseline:
        return []
    ordered = sorted(baseline)
    spread = max(abs(percentile(ordered, 0.01)), abs(percentile(ordered, 0.99)), *(abs(v) for v in event))
    limit = max(spread, 0.01)
    width = 2 * limit / HISTOGRAM_BUCKETS

    def shares(values: list[float]) -> list[float]:
        counts = [0] * HISTOGRAM_BUCKETS
        for value in values:
            raw = math.floor((value + limit) / width)
            counts[min(HISTOGRAM_BUCKETS - 1, max(0, raw))] += 1
        return [count / len(values) for count in counts]

    event_shares = shares(event)
    baseline_shares = shares(baseline)
    return [
        {"from": -limit + i * width, "to": -limit + (i + 1) * width, "eventShare": event_shares[i], "baselineShare": baseline_shares[i]}
        for i in range(HISTOGRAM_BUCKETS)
    ]


def final_car_interval(events: list[dict[str, Any]], offset: int) -> dict[str, Any]:
    """Every name reacting to the same date is one draw, so a Fed day is not counted five times."""
    by_date: dict[str, list[float]] = {}
    for event in events:
        by_date.setdefault(event["date"], []).append(event["car"])
    interval: Interval | None = cluster_bootstrap(list(by_date.values()), average)
    return {
        "offset": offset,
        "acar": average([event["car"] for event in events]) if events else 0,
        "dates": len(by_date),
        "interval": interval,
    }


def _notes(kind: str, symbols: list[str], benchmark: str, hold: int) -> list[str]:
    notes = [
        f"Abnormal return = actual return minus (alpha + beta x {benchmark}), with alpha and beta fitted on the {ESTIMATION_LEN} trading days ending {ESTIMATION_GAP} days before each event.",
        "Day 0 is the first trading session on or after the event date, so an announcement made after the close lands on day 0 of the next session.",
        f"The backtest buys the close of day -1 and sells the close of day +{hold}. It is one path with no costs, no slippage and no position sizing — read the per-event spread, not the curve.",
        f"The final CAR interval is the 5th–95th percentile of {BOOTSTRAP_RESAMPLES} resamples of event dates, each date drawn with all its names, so a shock that hit every name at once counts once. Needs {BOOTSTRAP_MIN_CLUSTERS} distinct dates.",
    ]
    if kind == "EARNINGS":
        notes.append(
            "Earnings dates come from Yahoo's 10-Q / 10-K filing list, shifted by the lag measured against the one announcement date Yahoo exposes. Yahoo does not publish historical announcement dates, so treat these as within a day of the real release."
        )
    if kind == "FOMC":
        notes.append("FOMC dates are the scheduled policy decision days from federalreserve.gov. Unscheduled meetings and notation votes are excluded.")
    if len(symbols) > 1:
        notes.append(
            "Symbols are pooled: every event is one observation, and the equity curve compounds overlapping trades sequentially as if only one were held at a time."
        )
    return notes


def run_event_study(symbols_in: list[str], kind: str, pre: int, post: int, years: int, hold: int) -> dict[str, Any]:
    symbols = list(dict.fromkeys(symbol.strip().upper() for symbol in symbols_in if symbol.strip()))
    if not symbols:
        raise AppError(400, "VALIDATION_ERROR", "At least one symbol is required.")
    now = utcnow()
    to_key = date_key(now)
    window_start = subtract_years(now, years)
    from_key = date_key(window_start)
    # Extra history so the estimation window exists for the earliest event.
    bars_from = subtract_years(window_start, 1)
    benchmark = _benchmark_for(symbols)

    with ThreadPoolExecutor(max_workers=4) as pool:
        dates_future = pool.submit(resolve_event_dates, kind, symbols, from_key, to_key)
        bench_future = pool.submit(_load_bars, benchmark, bars_from)
        symbol_futures = [pool.submit(_load_bars, symbol, bars_from) for symbol in symbols]
        event_dates = dates_future.result()
        bench_bars = bench_future.result()
        bars_by_symbol = {symbol: future.result() for symbol, future in zip(symbols, symbol_futures, strict=True)}

    bench_ret: dict[str, float] = {}
    bench_close: dict[str, float] = {}
    for i, key in enumerate(bench_bars.keys):
        ret = bench_bars.ret[i]
        if ret is not None:
            bench_ret[key] = ret
        bench_close[key] = bench_bars.close[i]

    offsets = [i - pre for i in range(pre + post + 1)]
    ar_by: dict[int, list[float]] = {offset: [] for offset in offsets}
    car_by: dict[int, list[float]] = {offset: [] for offset in offsets}
    events: list[dict[str, Any]] = []
    trades: list[dict[str, Any]] = []
    event_day_returns: list[float] = []
    excluded: dict[str, set[int]] = {symbol: set() for symbol in symbols}
    skipped = 0

    usable = []
    for event in event_dates:
        bars = bars_by_symbol.get(event["symbol"])
        if bars is None:
            skipped += 1
            continue
        anchor = anchor_index(bars.keys, event["date"])
        estimation_end = anchor - ESTIMATION_GAP
        if anchor < 0 or anchor - pre < 1 or anchor + post >= len(bars.keys) or estimation_end - MIN_ESTIMATION_OBS < 1:
            skipped += 1
            continue
        usable.append((event, bars, anchor))

    for event, bars, anchor in usable:
        estimation_end = anchor - ESTIMATION_GAP
        estimation_start = max(1, estimation_end - ESTIMATION_LEN)
        stock_est: list[float] = []
        bench_est: list[float] = []
        for i in range(estimation_start, estimation_end):
            stock_ret = bars.ret[i]
            b = bench_ret.get(bars.keys[i])
            if stock_ret is None or b is None:
                continue
            stock_est.append(stock_ret)
            bench_est.append(b)
        model = _market_model(stock_est, bench_est)
        if model is None:
            skipped += 1
            continue
        alpha, beta = model

        # Build the whole path first: a half-filled window would give offsets different sample sizes.
        path = []
        for offset in offsets:
            i = anchor + offset
            stock_ret = bars.ret[i]
            b = bench_ret.get(bars.keys[i])
            if stock_ret is None or b is None:
                break
            path.append((offset, i, stock_ret - (alpha + beta * b), stock_ret))
        if len(path) != len(offsets):
            skipped += 1
            continue

        car = 0.0
        day0_return = 0.0
        day0_abnormal = 0.0
        for offset, index, abnormal, actual in path:
            car += abnormal
            ar_by[offset].append(abnormal)
            car_by[offset].append(car)
            excluded[event["symbol"]].add(index)
            if offset == 0:
                day0_return = actual
                day0_abnormal = abnormal
        event_day_returns.append(day0_return)
        events.append(
            {
                "symbol": event["symbol"],
                "date": event["date"],
                "label": event["label"],
                "surprisePercent": event["surprisePercent"],
                "alpha": alpha,
                "beta": beta,
                "day0Return": day0_return,
                "day0Abnormal": day0_abnormal,
                "car": car,
            }
        )
        entry = anchor - 1
        exit_ = anchor + hold
        if entry >= 0 and exit_ < len(bars.keys):
            ret = bars.close[exit_] / bars.close[entry] - 1
            b_entry = bench_close.get(bars.keys[entry])
            b_exit = bench_close.get(bars.keys[exit_])
            b_ret = b_exit / b_entry - 1 if b_entry is not None and b_exit is not None else 0
            trades.append({"symbol": event["symbol"], "entryDate": bars.keys[entry], "exitDate": bars.keys[exit_], "ret": ret, "benchRet": b_ret, "excess": ret - b_ret})

    if not events:
        raise AppError(422, "INSUFFICIENT_DATA", "No event had both a full window and a clean estimation period. Try a shorter window or a longer history.")

    offset_stats = []
    for offset in offsets:
        ar = ar_by[offset]
        car_path = car_by[offset]
        aar_se = std_dev(ar) / math.sqrt(len(ar)) if len(ar) > 1 else 0
        acar_se = std_dev(car_path) / math.sqrt(len(car_path)) if len(car_path) > 1 else 0
        acar = average(car_path) if car_path else 0
        offset_stats.append(
            {"offset": offset, "aar": average(ar) if ar else 0, "aarSe": aar_se, "acar": acar, "acarSe": acar_se, "tStat": acar / acar_se if acar_se > 1e-12 else 0}
        )

    baseline: list[float] = []
    trading_days = 0
    buy_hold_sum = 0.0
    for symbol in symbols:
        bars = bars_by_symbol[symbol]
        first_close: float | None = None
        last_close: float | None = None
        for i in range(1, len(bars.keys)):
            if bars.keys[i] < from_key:
                continue
            trading_days += 1
            if first_close is None:
                first_close = bars.close[i - 1]
            last_close = bars.close[i]
            ret = bars.ret[i]
            if ret is not None and i not in excluded[symbol]:
                baseline.append(ret)
        if first_close is not None and last_close is not None and first_close > 0:
            buy_hold_sum += last_close / first_close - 1

    trades.sort(key=lambda trade: (trade["entryDate"], locale_key(trade["symbol"])))
    equity: list[dict[str, Any]] = []
    value = 100.0
    if trades:
        equity.append({"date": trades[0]["entryDate"], "value": value})
        for trade in trades:
            value *= 1 + trade["ret"]
            equity.append({"date": trade["exitDate"], "value": value})
    trade_returns = [trade["ret"] for trade in trades]
    ordered_trades = sorted(trade_returns)

    return {
        "symbols": symbols,
        "eventType": kind,
        "benchmark": benchmark,
        "window": {"pre": pre, "post": post},
        "years": years,
        "from": from_key,
        "to": to_key,
        "eventCount": len(events),
        "skippedCount": skipped,
        "offsets": offset_stats,
        "finalCar": final_car_interval(events, post),
        "events": events,
        "distribution": {"event": _describe(event_day_returns), "baseline": _describe(baseline), "buckets": _histogram(event_day_returns, baseline)},
        "backtest": {
            "holdDays": hold,
            "trades": trades,
            "equity": equity,
            "stats": {
                "trades": len(trades),
                "totalReturn": value / 100 - 1,
                "meanRet": average(trade_returns) if trade_returns else 0,
                "medianRet": percentile(ordered_trades, 0.5),
                "winRate": len([r for r in trade_returns if r > 0]) / len(trade_returns) if trade_returns else 0,
                "best": ordered_trades[-1] if ordered_trades else 0,
                "worst": ordered_trades[0] if ordered_trades else 0,
                "maxDrawdown": _max_drawdown([point["value"] for point in equity]),
                "tStat": _t_stat(trade_returns),
                "timeInMarketPct": len(trades) * (hold + 1) / trading_days if trading_days > 0 else 0,
                "buyHoldReturn": buy_hold_sum / len(symbols) if symbols else 0,
            },
        },
        "notes": _notes(kind, symbols, benchmark, hold),
    }
