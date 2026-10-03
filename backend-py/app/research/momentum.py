from dataclasses import dataclass, field
from typing import Any

from app.research.costs import cost_drag
from app.research.walk_forward import walk_forward
from app.rows import locale_key

# French momentum: 12 months before formation to 1 month before it.
FORMATION_MONTHS = 12
SKIP_MONTHS = 1
# Month-ends the fit is allowed to see: the formation window plus the skipped month.
TRAIN_MONTHS = FORMATION_MONTHS + SKIP_MONTHS


@dataclass(frozen=True)
class MonthEnd:
    month: str
    date: str
    index: int


def month_ends(dates: list[str]) -> list[MonthEnd]:
    """Last session present in each calendar month."""
    ends = []
    for i, day in enumerate(dates):
        month = day[:7]
        if i + 1 == len(dates) or dates[i + 1][:7] != month:
            ends.append(MonthEnd(month, day, i))
    return ends


def momentum_signal(levels: list[float], month_end_indexes: list[int], holding_month: int) -> float | None:
    """
    Return from the close 12 months before formation to the close 1 month
    before it. Neither the holding month nor the skipped month is an input.
    """
    start = holding_month - FORMATION_MONTHS - SKIP_MONTHS
    end = holding_month - SKIP_MONTHS - 1
    if start < 0 or end >= len(month_end_indexes):
        return None
    first = levels[month_end_indexes[start]]
    last = levels[month_end_indexes[end]]
    if not first > 0 or not last > 0:
        return None
    return last / first - 1


def top_third_count(names: int) -> int:
    if names < 1:
        return 0
    return max(1, names // 3)


def assign_weights(signals: list[dict[str, Any]], allow_short: bool) -> dict[str, float]:
    """Equal weight on the top third; shorts, when asked for, are the bottom third and dollar-neutral."""
    ranked = sorted(signals, key=lambda row: locale_key(row["symbol"]))
    ranked.sort(key=lambda row: row["signal"], reverse=True)
    count = top_third_count(len(ranked))
    if count == 0:
        return {}
    longs = ranked[:count]
    long_symbols = {row["symbol"] for row in longs}
    shorts = [row for row in ranked[-count:] if row["symbol"] not in long_symbols] if allow_short else []
    weights: dict[str, float] = {}
    if not shorts:
        for row in longs:
            weights[row["symbol"]] = 1 / count
        return weights
    for row in longs:
        weights[row["symbol"]] = 0.5 / count
    for row in shorts:
        weights[row["symbol"]] = -0.5 / len(shorts)
    return weights


def weight_turnover(prev: dict[str, float], nxt: dict[str, float]) -> float:
    """Sum of absolute weight changes. Entering from cash is 1; replacing the book is 2."""
    total = 0.0
    for symbol in dict.fromkeys([*prev.keys(), *nxt.keys()]):
        total += abs(nxt.get(symbol, 0) - prev.get(symbol, 0))
    return total


def _signed_pct(value: float) -> str:
    sign = "+" if value > 0 else ""
    return f"{sign}{value * 100:.1f}%"


def momentum_conclusion(strategy_annual: float, buy_hold_annual: float, sessions: int, names: int) -> str:
    gap = strategy_annual - buy_hold_annual
    verdict = "matches" if abs(gap) < 0.0005 else "beats" if gap > 0 else "does not beat"
    thin = " With fewer than three names the top third is the whole book, so this is not a cross-sectional test." if names < 3 else ""
    return (
        f"12-1 momentum {verdict} buy-and-hold after costs: {_signed_pct(strategy_annual)} annualized versus "
        f"{_signed_pct(buy_hold_annual)} for the same {names}-name universe, over {sessions} out-of-sample sessions.{thin}"
    )


@dataclass
class MomentumRun:
    days: list[dict[str, Any]] = field(default_factory=list)
    months: list[dict[str, Any]] = field(default_factory=list)
    long_count: int = 0
    short_count: int = 0
    latest_long: list[str] = field(default_factory=list)


def _symbol_returns(levels: list[list[float]], symbols: list[str], index: int) -> dict[str, float]:
    out = {}
    for s, symbol in enumerate(symbols):
        prev = levels[s][index - 1]
        out[symbol] = levels[s][index] / prev - 1 if prev > 0 else 0
    return out


def _book_return(weights: dict[str, float], rets: dict[str, float]) -> float:
    total = 0.0
    for symbol, weight in weights.items():
        total += weight * rets.get(symbol, 0)
    return total


def _drift(weights: dict[str, float], rets: dict[str, float], book: float) -> dict[str, float]:
    denom = 1 + book
    if not denom > 1e-8:
        return weights
    return {symbol: weight * (1 + rets.get(symbol, 0)) / denom for symbol, weight in weights.items()}


def run_momentum(
    dates: list[str], symbols: list[str], levels: list[list[float]], allow_short: bool, commission_bps: float, slippage_bps: float
) -> MomentumRun:
    """Walk-forward 12-1 momentum on total-return levels aligned to `dates`."""
    months = month_ends(dates)
    indexes = [month.index for month in months]
    run = MomentumRun()
    if len(months) < TRAIN_MONTHS + 1 or not symbols:
        return run
    held: dict[str, float] = {}

    def fit(_train_start: int, train_end: int) -> dict[str, float]:
        signals = []
        for s, symbol in enumerate(symbols):
            signal = momentum_signal(levels[s], indexes, train_end)
            if signal is not None:
                signals.append({"symbol": symbol, "signal": signal})
        return assign_weights(signals, allow_short)

    def apply(target: dict[str, float], test_start: int, _test_end: int) -> list[float]:
        nonlocal held
        turnover = weight_turnover(held, target)
        cost = cost_drag(turnover, commission_bps, slippage_bps)
        run.long_count = len([w for w in target.values() if w > 0])
        run.short_count = len([w for w in target.values() if w < 0])
        run.latest_long = sorted(symbol for symbol, weight in target.items() if weight > 0)
        month = months[test_start]
        month_days = [(day, index) for index, day in enumerate(dates) if day[:7] == month.month and index > 0]
        weights = target
        growth = 1.0
        for offset, (day, index) in enumerate(month_days):
            rets = _symbol_returns(levels, symbols, index)
            gross = _book_return(weights, rets)
            net = gross - (cost if offset == 0 else 0)
            weights = _drift(weights, rets, gross)
            growth *= 1 + net
            run.days.append({"date": day, "strategy": net, "buyHold": 0.0, "equalWeight": 0.0, "turnover": turnover if offset == 0 else 0})
        held = weights
        run.months.append({"month": month.month, "turnover": turnover, "strategy": growth - 1, "long": run.latest_long})
        return [growth - 1]

    walk_forward(len(months), TRAIN_MONTHS, 1, 1, fit, apply)
    _fill_comparators(dates, symbols, levels, run.days, commission_bps, slippage_bps)
    return run


def _fill_comparators(dates: list[str], symbols: list[str], levels: list[list[float]], days: list[dict[str, Any]], commission_bps: float, slippage_bps: float) -> None:
    """Buy-and-hold and monthly equal weight, on the same days, with the same cost schedule."""
    if not days:
        return
    index_of = {day: index for index, day in enumerate(dates)}
    equal = {symbol: 1 / len(symbols) for symbol in symbols}
    buy_weights = equal
    equal_weights = equal
    buy_charged = False
    current_month = ""
    for day in days:
        index = index_of[day["date"]]
        rets = _symbol_returns(levels, symbols, index)
        month = day["date"][:7]
        buy_cost = 0.0
        if not buy_charged:
            buy_cost = cost_drag(weight_turnover({}, buy_weights), commission_bps, slippage_bps)
            buy_charged = True
        buy_gross = _book_return(buy_weights, rets)
        day["buyHold"] = buy_gross - buy_cost
        buy_weights = _drift(buy_weights, rets, buy_gross)
        equal_cost = 0.0
        if month != current_month:
            equal_cost = cost_drag(weight_turnover(equal_weights if current_month else {}, equal), commission_bps, slippage_bps)
            equal_weights = equal
            current_month = month
        equal_gross = _book_return(equal_weights, rets)
        day["equalWeight"] = equal_gross - equal_cost
        equal_weights = _drift(equal_weights, rets, equal_gross)
