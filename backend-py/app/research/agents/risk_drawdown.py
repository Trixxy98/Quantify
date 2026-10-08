"""Risk (b): P(market drawdown ≤ −5% peak-to-trough inside the next month)."""

import math
from dataclasses import dataclass

from app.research.agents.horizon import FIVE_SESSIONS, next_n_max_drawdown
from app.research.agents.monthly import fresh_month, latest_month_ends, mean, month_distance, shift_month, symbol_months
from app.research.agents.types import Agent, AgentInput, AgentOutput, AgentPrediction, SymbolSeries
from app.research.logistic import CollinearError, logistic, predict_proba
from app.research.walk_forward import expanding_folds

RISK_DD_VERSION = "risk-dd-v1"
RISK_DD_5D_VERSION = "risk-dd-5d-v1"
MIN_TRAIN_MONTHS = 60
REFIT_MONTHS = 12
DRAWDOWN_THRESHOLD = -0.05
VOL_WINDOW = 22
CORR_WINDOW = 22
TREND_MONTHS = 3
MIN_CORR_NAMES = 5
MARKET_PROXY = ("SPY", "^GSPC")


@dataclass
class Sample:
    month: str
    features: list[float]  # vol, vol-of-vol, mean pairwise corr, index trend
    realized: float | None  # 1.0 if max DD ≤ −5%, else 0.0; None for live month


def _market_series(data: AgentInput) -> SymbolSeries | None:
    by_symbol = {series.symbol: series for series in data.series}
    for symbol in MARKET_PROXY:
        if symbol in by_symbol:
            return by_symbol[symbol]
    return None


def _index_on_or_before(dates: list[str], day: str) -> int | None:
    lo, hi = 0, len(dates)
    while lo < hi:
        mid = (lo + hi) // 2
        if dates[mid] <= day:
            lo = mid + 1
        else:
            hi = mid
    return lo - 1 if lo > 0 else None


def _daily_returns(series: SymbolSeries, start: int, end: int) -> list[float]:
    out = []
    for i in range(max(1, start), end + 1):
        prev = series.level[i - 1]
        if prev <= 0:
            continue
        value = series.level[i] / prev - 1
        if math.isfinite(value):
            out.append(value)
    return out


def _realized_vol(returns: list[float]) -> float:
    if len(returns) < 5:
        return math.nan
    mu = mean(returns)
    var = mean([(value - mu) ** 2 for value in returns])
    return math.sqrt(252 * var) if var > 0 else 0.0


def _vol_of_vol(returns: list[float], block: int = 5) -> float:
    if len(returns) < block * 3:
        return math.nan
    vols = []
    for i in range(block, len(returns) + 1):
        vols.append(_realized_vol(returns[i - block : i]))
    finite = [value for value in vols if math.isfinite(value)]
    if len(finite) < 3:
        return math.nan
    mu = mean(finite)
    return math.sqrt(mean([(value - mu) ** 2 for value in finite]))


def _mean_pairwise_corr(series_list: list[SymbolSeries], end_day: str) -> float:
    """Mean off-diagonal correlation of daily returns ending on/before end_day."""
    windows: list[list[float]] = []
    for series in series_list:
        i = _index_on_or_before(series.dates, end_day)
        if i is None or i < CORR_WINDOW:
            continue
        returns = _daily_returns(series, i - CORR_WINDOW + 1, i)
        if len(returns) >= CORR_WINDOW - 2:
            windows.append(returns[-CORR_WINDOW:])
    if len(windows) < MIN_CORR_NAMES:
        return math.nan
    # Align on the shortest length.
    n = min(len(window) for window in windows)
    windows = [window[-n:] for window in windows]
    pairs = 0
    total = 0.0
    for i in range(len(windows)):
        for j in range(i + 1, len(windows)):
            a, b = windows[i], windows[j]
            ma, mb = mean(a), mean(b)
            cov = va = vb = 0.0
            for k in range(n):
                da, db = a[k] - ma, b[k] - mb
                cov += da * db
                va += da * da
                vb += db * db
            if va > 0 and vb > 0:
                total += cov / math.sqrt(va * vb)
                pairs += 1
    return total / pairs if pairs else math.nan


def _index_trend(market: SymbolSeries, feature: int) -> float:
    months = symbol_months(market)
    # Approximate TREND_MONTHS calendar months back via month_ends map when possible.
    end = next((row for row in months.values() if row.feature == feature), None)
    if end is None:
        # Fallback: ~21 sessions per month.
        back = feature - TREND_MONTHS * 21
        if back < 0 or market.level[back] <= 0:
            return math.nan
        return market.level[feature] / market.level[back] - 1
    earlier = months.get(shift_month(end.month, -TREND_MONTHS))
    if earlier is None or market.level[earlier.feature] <= 0:
        return math.nan
    return market.level[feature] / market.level[earlier.feature] - 1


def _max_drawdown(levels: list[float], start: int, end: int) -> float:
    peak = -math.inf
    worst = 0.0
    for i in range(start, end + 1):
        value = levels[i]
        if value > peak:
            peak = value
        if peak > 0:
            worst = min(worst, value / peak - 1)
    return worst


def _features(data: AgentInput, market: SymbolSeries, feature: int, feature_day: str) -> list[float] | None:
    start = feature - VOL_WINDOW + 1
    if start < 1:
        return None
    returns = _daily_returns(market, start, feature)
    vol = _realized_vol(returns)
    vov = _vol_of_vol(returns)
    us = [series for series in data.series if series.market == "US" and series.symbol not in MARKET_PROXY]
    corr = _mean_pairwise_corr(us, feature_day)
    trend = _index_trend(market, feature)
    values = [vol, vov, corr, trend]
    return values if all(math.isfinite(value) for value in values) else None


def _build_samples(data: AgentInput, sessions: int | None = None) -> tuple[SymbolSeries, list[Sample]] | tuple[None, list[Sample]]:
    market = _market_series(data)
    if market is None:
        return None, []
    months = symbol_months(market)
    latest = latest_month_ends([months])
    as_of_month = data.as_of[:7]
    current = latest.get(as_of_month)
    if current is None or current < data.as_of:
        latest[as_of_month] = data.as_of

    samples: list[Sample] = []
    for month in sorted(latest):
        now = fresh_month(months, month, latest)
        if now is None:
            continue
        features = _features(data, market, now.feature, now.date)
        if features is None:
            continue
        nxt = fresh_month(months, shift_month(month, 1), latest)
        realized = None
        if sessions:
            dd = next_n_max_drawdown(market, now.index, sessions)
            if dd is not None:
                realized = 1.0 if dd <= DRAWDOWN_THRESHOLD else 0.0
        elif nxt is not None:
            dd = _max_drawdown(market.level, now.index, nxt.index)
            realized = 1.0 if dd <= DRAWDOWN_THRESHOLD else 0.0
        samples.append(Sample(month, features, realized))
    return market, samples


def _trainable(samples: list[Sample], first_test: str) -> list[Sample]:
    return [sample for sample in samples if month_distance(sample.month, first_test) >= 2 and sample.realized is not None]


def run_risk_drawdown(data: AgentInput, sessions: int | None = None) -> AgentOutput:
    market, samples = _build_samples(data, sessions)
    window = f"the next {sessions} sessions" if sessions else "the next month"
    notes = [
        f"Logistic P(market peak-to-trough drawdown ≤ {DRAWDOWN_THRESHOLD:.0%} inside {window}), on {MARKET_PROXY[0]} (or {MARKET_PROXY[1]}).",
        f"Features at the session before month end: trailing {VOL_WINDOW}-day vol, vol-of-vol, mean pairwise corr of US names, and {TREND_MONTHS}-month index trend.",
        "Baseline is the training-window hit rate (climatology). One forecast per month (index view).",
        f"Expanding walk-forward: at least {MIN_TRAIN_MONTHS} months of training, refit every {REFIT_MONTHS}.",
    ]
    if market is None:
        notes.append("No SPY or ^GSPC series in the input; cannot score the market drawdown agent.")
        version = RISK_DD_5D_VERSION if sessions else RISK_DD_VERSION
        horizon = "5d" if sessions else "1m"
        return AgentOutput("risk", version, "probDrawdown", horizon, [], notes)

    predictions: list[AgentPrediction] = []
    for fold in expanding_folds(len(samples), MIN_TRAIN_MONTHS, REFIT_MONTHS):
        test = samples[fold.test_start : fold.test_end]
        train = _trainable(samples[: fold.train_end], test[0].month)
        if len(train) < 20:
            continue
        y = [int(sample.realized) for sample in train if sample.realized is not None]
        if len(set(y)) < 2:
            continue
        x = [sample.features for sample in train]
        try:
            fit = logistic(y, x)
        except (CollinearError, ValueError):
            continue
        base_rate = mean([float(sample.realized) for sample in train if sample.realized is not None])
        probs = predict_proba(fit["beta"], [sample.features for sample in test])
        for i, sample in enumerate(test):
            predictions.append(AgentPrediction(sample.month, market.symbol, probs[i], base_rate, sample.realized))

    if not predictions:
        notes.append(f"Need {MIN_TRAIN_MONTHS + 1} month ends with complete features before the first forecast.")
    version = RISK_DD_5D_VERSION if sessions else RISK_DD_VERSION
    horizon = "5d" if sessions else "1m"
    return AgentOutput("risk", version, "probDrawdown", horizon, predictions, notes)


def run_risk_drawdown_5d(data: AgentInput) -> AgentOutput:
    return run_risk_drawdown(data, FIVE_SESSIONS)


risk_drawdown_agent = Agent(name="risk", version=RISK_DD_VERSION, target="probDrawdown", horizon="1m", run=run_risk_drawdown)
risk_drawdown_5d_agent = Agent(name="risk", version=RISK_DD_5D_VERSION, target="probDrawdown", horizon="5d", run=run_risk_drawdown_5d)