"""One-month decision rules. Five-session forecasts are never inputs. Sentiment is absent until it has 12 scored months."""

import math
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.research.agents.scoring import spearman
from app.research.agents.types import AgentOutput, AgentPrediction
from app.research.costs import cost_drag
from app.research.momentum import weight_turnover

MIN_SCORED_MONTHS = 12
TRAIL_MONTHS = 12
MIN_NAMES = 5
SHRINK = 0.5
DRAWDOWN_PERCENTILE = 0.80
RETURN_AGENTS = ("technical", "quant", "event", "sentiment")


@dataclass(frozen=True)
class AgentView:
    name: str
    forecasts: dict[str, float]
    monthly_ic: list[float]


@dataclass(frozen=True)
class DecisionRow:
    symbol: str
    weight: float
    action: str
    reason: str
    rules: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Decision:
    month: str | None
    rows: list[DecisionRow]
    weights: dict[str, float]
    notes: list[str]


def monthly_ic(predictions: Sequence[AgentPrediction]) -> list[float]:
    """Spearman IC of each month whose outcome is already known, oldest first."""
    by_month: dict[str, list[AgentPrediction]] = {}
    for row in predictions:
        if row.realized is None:
            continue
        by_month.setdefault(row.month, []).append(row)
    values: list[float] = []
    for month in sorted(by_month):
        realized = [row.realized for row in by_month[month] if row.realized is not None]
        forecasts = [row.forecast for row in by_month[month] if row.realized is not None]
        if len(realized) < MIN_NAMES:
            continue
        value = spearman(forecasts, realized)
        if value == value:
            values.append(value)
    return values


def trailing_ic(series: Sequence[float]) -> float | None:
    if len(series) < MIN_SCORED_MONTHS:
        return None
    window = list(series[-TRAIL_MONTHS:])
    return sum(window) / len(window)


def agent_weights(agents: Sequence[AgentView]) -> dict[str, float]:
    """Proportional to trailing IC, floored at zero, then shrunk halfway toward equal weight.

    Negative IC and fewer than 12 scored months both get zero. The shrink is only among the agents that remain.
    """
    weights = {agent.name: 0.0 for agent in agents}
    eligible = [(agent.name, ic) for agent in agents if (ic := trailing_ic(agent.monthly_ic)) is not None and ic > 0]
    if not eligible:
        return weights
    total = sum(ic for _, ic in eligible)
    equal = 1 / len(eligible)
    for name, ic in eligible:
        weights[name] = SHRINK * (ic / total) + (1 - SHRINK) * equal
    return weights


def _zscore(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    mean = sum(values.values()) / len(values)
    var = sum((value - mean) ** 2 for value in values.values()) / len(values)
    scale = math.sqrt(var)
    if scale == 0:
        return {symbol: 0.0 for symbol in values}
    return {symbol: (value - mean) / scale for symbol, value in values.items()}


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _percentile(values: Sequence[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(fraction * len(ordered)) - 1))
    return ordered[index]


def _latest_month(outputs: Sequence[AgentOutput]) -> str | None:
    months = [row.month for output in outputs for row in output.predictions]
    return max(months) if months else None


def views_from_outputs(outputs: Sequence[AgentOutput], month: str) -> list[AgentView]:
    views: list[AgentView] = []
    for output in outputs:
        if output.horizon != "1m" or output.target != "returnScore" or output.agent not in RETURN_AGENTS:
            continue
        forecasts = {row.symbol: row.forecast for row in output.predictions if row.month == month}
        if len(forecasts) < MIN_NAMES:
            continue
        views.append(AgentView(output.agent, forecasts, monthly_ic(output.predictions)))
    return views


def decide(
    agents: Sequence[AgentView],
    vols: dict[str, float],
    drawdown: float | None,
    drawdown_history: Sequence[float],
    month: str | None,
) -> Decision:
    notes = [
        "Decisions use the one-month horizon only. Sentiment has no weight until 12 scored months exist.",
    ]
    weights = agent_weights(agents)
    active = [agent for agent in agents if weights.get(agent.name, 0) > 0]
    if not active:
        notes.append("No return agent has 12 months of positive trailing IC, so the book is cash.")
        return Decision(
            month,
            [DecisionRow("CASH", 1.0, "cash", "Cash: no return agent has a positive trailing IC over 12 scored months.", ["combine"])],
            weights,
            notes,
        )

    standardised = {agent.name: _zscore(agent.forecasts) for agent in active}
    symbols = sorted({symbol for agent in active for symbol in agent.forecasts})
    combined: dict[str, float] = {}
    for symbol in symbols:
        present = [agent for agent in active if symbol in standardised[agent.name]]
        mass = sum(weights[agent.name] for agent in present)
        if mass <= 0:
            continue
        combined[symbol] = sum(weights[agent.name] * standardised[agent.name][symbol] for agent in present) / mass
    if len(combined) < MIN_NAMES:
        notes.append("Fewer than five names have a return score, so the book is cash.")
        return Decision(month, [DecisionRow("CASH", 1.0, "cash", "Cash: the cross-section is too thin to rank.", ["combine"])], weights, notes)

    ordered = sorted(combined, key=lambda symbol: combined[symbol], reverse=True)
    top_count = max(1, math.ceil(len(ordered) / 3))
    top = set(ordered[:top_count])

    held: list[str] = []
    skipped: list[DecisionRow] = []
    for symbol in ordered:
        if symbol not in top:
            continue
        voters = [agent for agent in active if symbol in agent.forecasts]
        mass = sum(weights[agent.name] for agent in voters)
        above = [
            agent
            for agent in voters
            if agent.forecasts[symbol] > _median(list(agent.forecasts.values()))
        ]
        agree = sum(weights[agent.name] for agent in above)
        share = agree / mass if mass else 0
        names = ", ".join(agent.name for agent in above) or "none"
        if share + 1e-12 < 0.5:
            skipped.append(
                DecisionRow(
                    symbol,
                    0.0,
                    "skip",
                    f"Skipped: agents disagree. {names} rank {symbol} above median, carrying {share:.0%} of the weight.",
                    ["combine", "conflict"],
                )
            )
            continue
        held.append(symbol)

    usable = {symbol: vols[symbol] for symbol in held if vols.get(symbol, 0) > 0}
    missing = [symbol for symbol in held if symbol not in usable]
    if missing:
        notes.append(f"No vol forecast for {', '.join(missing)}; those names are left out of the book.")
        for symbol in missing:
            skipped.append(
                DecisionRow(symbol, 0.0, "skip", f"Skipped: {symbol} is in the top third but has no vol forecast.", ["combine", "conflict", "size"])
            )

    history = list(drawdown_history)
    threshold = _percentile(history, DRAWDOWN_PERCENTILE) if len(history) >= MIN_SCORED_MONTHS else None
    halved = drawdown is not None and threshold is not None and drawdown > threshold
    scale = 0.5 if halved else 1.0

    rows: list[DecisionRow] = []
    if not usable:
        rows.append(DecisionRow("CASH", 1.0, "cash", "Cash: nothing in the top third cleared the conflict and vol checks.", ["combine", "conflict", "size"]))
    else:
        inverse = sum(1 / vol for vol in usable.values())
        for symbol, vol in usable.items():
            weight = scale * (1 / vol) / inverse
            reason = f"Held: top third of the combined rank, and agents with at least half the weight rank {symbol} above median. Inverse-vol weight {weight:.0%}."
            rules = ["combine", "conflict", "size"]
            if halved:
                reason += f" Exposure halved: drawdown probability {drawdown:.2f} is above its trailing 80th percentile of {threshold:.2f}."
                rules.append("risk-limit")
            rows.append(DecisionRow(symbol, weight, "hold", reason, rules))
        cash = 1 - sum(row.weight for row in rows)
        if cash > 1e-9:
            if halved and threshold is not None and drawdown is not None:
                cash_reason = f"Cash: exposure halved because drawdown probability {drawdown:.2f} is above its trailing 80th percentile of {threshold:.2f}."
            else:
                cash_reason = "Cash: residual after the held names."
            rows.append(DecisionRow("CASH", cash, "cash", cash_reason, ["size", "risk-limit"] if halved else ["size"]))
    rows.extend(skipped)
    return Decision(month, rows, weights, notes)


def decide_from_outputs(outputs: Sequence[AgentOutput]) -> Decision:
    month = _latest_month([output for output in outputs if output.horizon == "1m" and output.target == "returnScore"])
    if month is None:
        return Decision(None, [], {}, ["No one-month return forecasts to decide on."])
    agents = views_from_outputs(outputs, month)
    vols: dict[str, float] = {}
    drawdown: float | None = None
    history: list[float] = []
    for output in outputs:
        if output.horizon != "1m" or output.agent != "risk":
            continue
        if output.target == "vol":
            vols = {row.symbol: row.forecast for row in output.predictions if row.month == month and row.forecast > 0}
        elif output.target == "probDrawdown":
            by_month: dict[str, float] = {}
            for row in output.predictions:
                by_month[row.month] = row.forecast
            drawdown = by_month.get(month)
            history = [by_month[key] for key in sorted(by_month) if key < month]
    return decide(agents, vols, drawdown, history, month)


def _return_outputs(outputs: Sequence[AgentOutput]) -> list[AgentOutput]:
    return [output for output in outputs if output.horizon == "1m" and output.target == "returnScore" and output.agent in RETURN_AGENTS]


def _realized(outputs: Sequence[AgentOutput]) -> dict[str, dict[str, float]]:
    """Next-month total return already stored on each forecast row."""
    by_month: dict[str, dict[str, float]] = {}
    for output in _return_outputs(outputs):
        for row in output.predictions:
            if row.realized is None:
                continue
            by_month.setdefault(row.month, {}).setdefault(row.symbol, row.realized)
    return by_month


def _views_as_of(outputs: Sequence[AgentOutput], month: str) -> list[AgentView]:
    views: list[AgentView] = []
    for output in _return_outputs(outputs):
        forecasts = {row.symbol: row.forecast for row in output.predictions if row.month == month}
        if len(forecasts) < MIN_NAMES:
            continue
        past = [row for row in output.predictions if row.month < month]
        views.append(AgentView(output.agent, forecasts, monthly_ic(past)))
    return views


def _risk_as_of(outputs: Sequence[AgentOutput], month: str) -> tuple[dict[str, float], float | None, list[float]]:
    vols: dict[str, float] = {}
    drawdown: float | None = None
    history: list[float] = []
    for output in outputs:
        if output.horizon != "1m" or output.agent != "risk":
            continue
        if output.target == "vol":
            vols = {row.symbol: row.forecast for row in output.predictions if row.month == month and row.forecast > 0}
        elif output.target == "probDrawdown":
            by_month = {row.month: row.forecast for row in output.predictions}
            drawdown = by_month.get(month)
            history = [by_month[key] for key in sorted(by_month) if key < month]
    return vols, drawdown, history


def _book_return(weights: dict[str, float], rets: dict[str, float]) -> float:
    return sum(weight * rets.get(symbol, 0.0) for symbol, weight in weights.items())


def _drift(weights: dict[str, float], rets: dict[str, float], book: float) -> dict[str, float]:
    denom = 1 + book
    if not denom > 1e-8:
        return dict(weights)
    return {symbol: weight * (1 + rets.get(symbol, 0.0)) / denom for symbol, weight in weights.items()}


def _top_equal(forecasts: dict[str, float]) -> dict[str, float]:
    ordered = sorted(forecasts, key=lambda symbol: forecasts[symbol], reverse=True)
    count = max(1, math.ceil(len(ordered) / 3))
    return {symbol: 1 / count for symbol in ordered[:count]}


def _best_book(views: Sequence[AgentView]) -> tuple[str | None, dict[str, float]]:
    eligible = [(view, ic) for view in views if (ic := trailing_ic(view.monthly_ic)) is not None and ic > 0]
    if not eligible:
        return None, {}
    view = max(eligible, key=lambda item: item[1])[0]
    return view.name, _top_equal(view.forecasts)


def evaluate(outputs: Sequence[AgentOutput], benchmark: dict[str, float] | None = None) -> dict[str, object]:
    """Mark the decision book to market after costs. Information coefficients use only earlier months."""
    realized = _realized(outputs)
    months = [month for month, rows in sorted(realized.items()) if len(rows) >= MIN_NAMES]
    levels = {"strategy": 100.0, "buyHold": 100.0, "equalWeight": 100.0, "bestAgent": 100.0, "benchmark": 100.0}
    held: dict[str, float] = {}
    buy: dict[str, float] = {}
    equal_held: dict[str, float] = {}
    best_held: dict[str, float] = {}
    best_name: str | None = None
    points: list[dict[str, object]] = []
    for month in months:
        rets = realized[month]
        views = _views_as_of(outputs, month)
        vols, drawdown, history = _risk_as_of(outputs, month)
        decision = decide(views, vols, drawdown, history, month)
        target = {row.symbol: row.weight for row in decision.rows if row.action == "hold"}
        gross = _book_return(target, rets)
        net = gross - cost_drag(weight_turnover(held, target))
        held = _drift(target, rets, gross)

        names = sorted(rets)
        equal = {symbol: 1 / len(names) for symbol in names}
        if not buy:
            buy = dict(equal)
            buy_gross = _book_return(buy, rets)
            buy_net = buy_gross - cost_drag(weight_turnover({}, buy))
            buy = _drift(buy, rets, buy_gross)
        else:
            buy_gross = _book_return(buy, rets)
            buy_net = buy_gross
            buy = _drift(buy, rets, buy_gross)
        equal_gross = _book_return(equal, rets)
        equal_net = equal_gross - cost_drag(weight_turnover(equal_held, equal))
        equal_held = _drift(equal, rets, equal_gross)

        name, best_target = _best_book(views)
        if name:
            best_name = name
        best_gross = _book_return(best_target, rets)
        best_net = best_gross - cost_drag(weight_turnover(best_held, best_target))
        best_held = _drift(best_target, rets, best_gross)

        bench = None if benchmark is None else benchmark.get(month)
        levels["strategy"] *= 1 + net
        levels["buyHold"] *= 1 + buy_net
        levels["equalWeight"] *= 1 + equal_net
        levels["bestAgent"] *= 1 + best_net
        if bench is not None:
            levels["benchmark"] *= 1 + bench
        points.append(
            {
                "month": month,
                "strategy": levels["strategy"],
                "buyHold": levels["buyHold"],
                "equalWeight": levels["equalWeight"],
                "bestAgent": levels["bestAgent"],
                "benchmark": None if bench is None else levels["benchmark"],
            }
        )
    return {"equity": points, "bestAgent": best_name, "months": len(points)}


def _forecasts_by_month(output: AgentOutput) -> dict[str, dict[str, float]]:
    by_month: dict[str, dict[str, float]] = {}
    for row in output.predictions:
        by_month.setdefault(row.month, {})[row.symbol] = row.forecast
    return by_month


def forecast_correlation(outputs: Sequence[AgentOutput]) -> dict[str, object]:
    """Mean monthly Spearman correlation of one-month return ranks, across shared names."""
    books = {output.agent: _forecasts_by_month(output) for output in _return_outputs(outputs)}
    agents = [name for name in RETURN_AGENTS if name in books]
    pairs: list[dict[str, object]] = []
    for i, left in enumerate(agents):
        for right in agents[i + 1 :]:
            values: list[float] = []
            latest_month: str | None = None
            latest: float | None = None
            months = sorted(set(books[left]) & set(books[right]))
            for month in months:
                shared = sorted(set(books[left][month]) & set(books[right][month]))
                if len(shared) < MIN_NAMES:
                    continue
                value = spearman([books[left][month][symbol] for symbol in shared], [books[right][month][symbol] for symbol in shared])
                if value != value:
                    continue
                values.append(value)
                latest_month = month
                latest = value
            pairs.append(
                {
                    "left": left,
                    "right": right,
                    "mean": None if not values else sum(values) / len(values),
                    "latest": latest,
                    "latestMonth": latest_month,
                    "months": len(values),
                }
            )
    return {"agents": agents, "pairs": pairs}
