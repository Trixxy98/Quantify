import math
from dataclasses import dataclass

from app.research.agents.horizon import FIVE_SESSIONS, outcome_return
from app.research.agents.monthly import (
    SymbolMonth,
    fresh_month,
    latest_month_ends,
    mean,
    month_distance,
    shift_month,
    symbol_months,
)
from app.research.agents.scoring import rank_score, spearman
from app.research.agents.types import Agent, AgentInput, AgentOutput, AgentPrediction, SymbolSeries
from app.research.ridge import predict, ridge
from app.research.walk_forward import expanding_folds

TECHNICAL_VERSION = "technical-ridge-v1"
TECHNICAL_5D_VERSION = "technical-ridge-5d-v1"
# Fixed before the first run. Penalty on standardised features against a [-0.5, 0.5] rank target.
TECHNICAL_LAMBDAS = [0.01, 0.1, 1, 10]
MIN_TRAIN_MONTHS = 60
REFIT_MONTHS = 12
# The penalty is picked on the last two years of each training window, one fit per year.
INNER_BLOCK_MONTHS = 12
INNER_BLOCKS = 2
MIN_CROSS_SECTION = 5
WINSOR_Z = 3
MA_SESSIONS = 200
TECHNICAL_FEATURES = ["1m return", "3m return", "6m return", "12-1 momentum", "distance from 200-day mean"]
MOMENTUM_FEATURE = 3


@dataclass
class Row:
    symbol: str
    raw: list[float]
    z: list[float]
    realized: float | None


@dataclass
class MonthPanel:
    month: str
    rows: list[Row]


def technical_features(series: SymbolSeries, months: dict[str, SymbolMonth], month: str) -> list[float] | None:
    """Inputs for one name at one month end, all read at the session before the month-end close."""
    now = months.get(month)
    if now is None or now.feature < MA_SESSIONS - 1:
        return None

    def back(by: int) -> int | None:
        found = months.get(shift_month(month, -by))
        return found.feature if found else None

    i1, i3, i6, i12 = back(1), back(3), back(6), back(12)
    if i1 is None or i3 is None or i6 is None or i12 is None:
        return None
    level = series.level
    at = level[now.feature]
    window = level[now.feature - MA_SESSIONS + 1 : now.feature + 1]
    try:
        values = [at / level[i1] - 1, at / level[i3] - 1, at / level[i6] - 1, level[i1] / level[i12] - 1, at / mean(window) - 1]
    except ZeroDivisionError:
        return None
    return values if all(math.isfinite(value) for value in values) else None


def _standardise(rows: list[dict]) -> list[list[float]]:
    k = len(rows[0]["raw"])
    z = [[0.0] * k for _ in rows]
    for j in range(k):
        column = [row["raw"][j] for row in rows]
        mu = mean(column)
        sd = math.sqrt(mean([(value - mu) ** 2 for value in column]))
        if not sd > 0:
            continue
        for i in range(len(rows)):
            z[i][j] = max(-WINSOR_Z, min(WINSOR_Z, (column[i] - mu) / sd))
    return z


def _build_panel(data: AgentInput, sessions: int | None = None) -> list[MonthPanel]:
    us = [series for series in data.series if series.market == "US"]
    months = [symbol_months(series) for series in us]
    latest = latest_month_ends(months)
    as_of_month = data.as_of[:7]
    current = latest.get(as_of_month)
    if current is None or current < data.as_of:
        latest[as_of_month] = data.as_of

    panels: list[MonthPanel] = []
    for month in sorted(latest):
        raw: list[dict] = []
        for s, series in enumerate(us):
            now = fresh_month(months[s], month, latest)
            if now is None:
                continue
            features = technical_features(series, months[s], month)
            if features is None:
                continue
            nxt = fresh_month(months[s], shift_month(month, 1), latest)
            realized = outcome_return(series, now.index, nxt.index if nxt else None, sessions)
            raw.append({"symbol": series.symbol, "raw": features, "realized": realized if realized is not None and math.isfinite(realized) else None})
        if len(raw) < MIN_CROSS_SECTION:
            continue
        z = _standardise(raw)
        panels.append(MonthPanel(month, [Row(row["symbol"], row["raw"], z[i], row["realized"]) for i, row in enumerate(raw)]))
    return panels


def _fit(panels: list[MonthPanel], lam: float) -> list[float] | None:
    """Stacked rows with the month's realized returns as [-0.5, 0.5] rank scores."""
    x: list[list[float]] = []
    y: list[float] = []
    for panel in panels:
        known = [row for row in panel.rows if row.realized is not None]
        if len(known) < MIN_CROSS_SECTION:
            continue
        scores = rank_score([row.realized for row in known])  # type: ignore[misc]
        for i, row in enumerate(known):
            x.append(row.z)
            y.append(scores[i])
    if not y:
        return None
    try:
        return ridge(x, y, lam)
    except (ValueError, ArithmeticError):
        return None


def _trainable(panels: list[MonthPanel], first_test: str) -> list[MonthPanel]:
    """Months whose outcome was known before the first test month's inputs were read."""
    return [panel for panel in panels if month_distance(panel.month, first_test) >= 2]


def _month_ic(beta: list[float], panel: MonthPanel) -> float:
    known = [row for row in panel.rows if row.realized is not None]
    if len(known) < MIN_CROSS_SECTION:
        return math.nan
    return spearman([predict(beta, row.z) for row in known], [row.realized for row in known])  # type: ignore[misc]


def choose_lambda(train: list[MonthPanel]) -> float:
    """Inner walk-forward on the training window only; ties go to the stronger penalty."""
    fallback = TECHNICAL_LAMBDAS[len(TECHNICAL_LAMBDAS) // 2]
    validation = INNER_BLOCK_MONTHS * INNER_BLOCKS
    if len(train) < validation + MIN_TRAIN_MONTHS / 2:
        return fallback
    best = fallback
    best_ic = -math.inf
    for lam in TECHNICAL_LAMBDAS:
        ics: list[float] = []
        for block in range(INNER_BLOCKS):
            start = len(train) - validation + block * INNER_BLOCK_MONTHS
            test = train[start : start + INNER_BLOCK_MONTHS]
            beta = _fit(_trainable(train[:start], test[0].month), lam)
            if beta is None:
                continue
            for panel in test:
                ic = _month_ic(beta, panel)
                if math.isfinite(ic):
                    ics.append(ic)
        score = mean(ics) if ics else -math.inf
        if score >= best_ic:
            best_ic = score
            best = lam
    return best


def run_technical(data: AgentInput, sessions: int | None = None) -> AgentOutput:
    panels = _build_panel(data, sessions)
    predictions: list[AgentPrediction] = []
    lambdas: list[float] = []
    for fold in expanding_folds(len(panels), MIN_TRAIN_MONTHS, REFIT_MONTHS):
        test = panels[fold.test_start : fold.test_end]
        train = _trainable(panels[: fold.train_end], test[0].month)
        lam = choose_lambda(train)
        beta = _fit(train, lam)
        if beta is None:
            continue
        lambdas.append(lam)
        for panel in test:
            for row in panel.rows:
                predictions.append(AgentPrediction(panel.month, row.symbol, predict(beta, row.z), row.raw[MOMENTUM_FEATURE], row.realized))

    notes = [
        f"Cross-sectional ridge on {', '.join(TECHNICAL_FEATURES)}, each standardised across names every month and capped at ±{WINSOR_Z}. The target is the total-return rank over the next {sessions} sessions."
        if sessions
        else f"Cross-sectional ridge on {', '.join(TECHNICAL_FEATURES)}, each standardised across names every month and capped at ±{WINSOR_Z}. The target is next month's total-return rank.",
        f"Expanding walk-forward: at least {MIN_TRAIN_MONTHS} months of training, refit every {REFIT_MONTHS}. The penalty is chosen from {', '.join(_js(v) for v in TECHNICAL_LAMBDAS)} on the last {INNER_BLOCK_MONTHS * INNER_BLOCKS} training months only.",
        "Inputs are read one session before the month-end close, and a training month is only used once its outcome was known before the forecast.",
    ]
    if lambdas:
        notes.append(f"Penalties chosen per refit: {', '.join(_js(v) for v in lambdas)}.")
    else:
        notes.append(f"Need {MIN_TRAIN_MONTHS + 1} months with at least {MIN_CROSS_SECTION} names before the first forecast.")
    version = TECHNICAL_5D_VERSION if sessions else TECHNICAL_VERSION
    horizon = "5d" if sessions else "1m"
    return AgentOutput("technical", version, "returnScore", horizon, predictions, notes)


def run_technical_5d(data: AgentInput) -> AgentOutput:
    return run_technical(data, FIVE_SESSIONS)


def _js(value: float) -> str:
    return str(int(value)) if value == int(value) else repr(value)


technical_agent = Agent(name="technical", version=TECHNICAL_VERSION, target="returnScore", horizon="1m", run=run_technical)
technical_5d_agent = Agent(name="technical", version=TECHNICAL_5D_VERSION, target="returnScore", horizon="5d", run=run_technical_5d)
