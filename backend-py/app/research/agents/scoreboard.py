from typing import Any

from app.research.agents.monthly import mean
from app.research.agents.scoring import newey_west_mean, qlike, spearman
from app.research.agents.types import AgentOutput, AgentPrediction
from app.research.bootstrap import Interval, stationary_bootstrap
from app.research.costs import cost_drag
from app.research.momentum import top_third_count, weight_turnover
from app.rows import locale_key

# Monthly series: three months of autocorrelation for the SE, three-month blocks for the bootstrap.
SCORE_NW_LAG = 3
SCORE_BLOCK_MONTHS = 3
MIN_SCORED_NAMES = 5
# Below this the t-stat is too unstable to put a verdict on.
MIN_VERDICT_MONTHS = 12


def _scored_months(predictions: list[AgentPrediction]) -> list[tuple[str, list[AgentPrediction]]]:
    by_month: dict[str, list[AgentPrediction]] = {}
    for row in predictions:
        if row.realized is None:
            continue
        by_month.setdefault(row.month, []).append(row)
    return sorted(((month, rows) for month, rows in by_month.items() if len(rows) >= MIN_SCORED_NAMES), key=lambda item: item[0])


def _mean_interval(series: list[float]) -> Interval | None:
    return stationary_bootstrap(series, {"mean": mean}, block_length=SCORE_BLOCK_MONTHS)["mean"]


def spread_returns(months: list[tuple[str, list[AgentPrediction]]]) -> tuple[list[float], list[float]]:
    """Long the top third, short the bottom third by forecast, equal weight, rebalanced monthly."""
    held: dict[str, float] = {}
    net: list[float] = []
    turnover: list[float] = []
    for _, rows in months:
        ordered = sorted(rows, key=lambda row: locale_key(row.symbol))
        ordered.sort(key=lambda row: row.forecast, reverse=True)
        count = top_third_count(len(ordered))
        top = ordered[:count]
        bottom = ordered[-count:]
        weights: dict[str, float] = {}
        for row in top:
            weights[row.symbol] = 1 / count
        for row in bottom:
            weights[row.symbol] = weights.get(row.symbol, 0) - 1 / count
        traded = weight_turnover(held, weights)
        gross = mean([row.realized for row in top]) - mean([row.realized for row in bottom])  # type: ignore[misc]
        net.append(gross - cost_drag(traded))
        turnover.append(traded)
        held = weights
    return net, turnover


def _base(output: AgentOutput) -> dict[str, Any]:
    return {"agent": output.agent, "version": output.version, "target": output.target, "horizon": output.horizon}


def score_return_agent(output: AgentOutput) -> dict[str, Any]:
    months = _scored_months(output.predictions)
    ic: list[float] = []
    base_ic: list[float] = []
    kept = []
    for month, rows in months:
        realized = [row.realized for row in rows]
        a = spearman([row.forecast for row in rows], realized)  # type: ignore[arg-type]
        b = spearman([row.baseline for row in rows], realized)  # type: ignore[arg-type]
        if a != a or b != b:
            continue
        ic.append(a)
        base_ic.append(b)
        kept.append((month, rows))
    stats = newey_west_mean(ic, SCORE_NW_LAG)
    base = newey_west_mean(base_ic, SCORE_NW_LAG)
    diff = newey_west_mean([value - base_ic[i] for i, value in enumerate(ic)], SCORE_NW_LAG)
    net, turnover = spread_returns(kept)
    interval = _mean_interval(ic)

    verdict = f"Only {len(ic)} scored months; too few to judge."
    if stats and len(ic) >= MIN_VERDICT_MONTHS:
        skill = stats["tStat"] >= 2 and (interval is None or interval["low"] > 0)
        head = f"Mean IC {stats['mean']:.3f} (t = {stats['tStat']:.2f}) over {len(ic)} months."
        body = " Evidence of ranking skill." if skill else " It ranks names the wrong way round." if stats["tStat"] <= -2 else " No evidence of ranking skill."
        versus = (
            ""
            if not diff
            else " Beats plain 12-1 momentum."
            if diff["tStat"] >= 2
            else " Worse than plain 12-1 momentum."
            if diff["tStat"] <= -2
            else " Not distinguishable from plain 12-1 momentum."
        )
        verdict = head + body + versus

    return {
        **_base(output),
        "metric": "Mean monthly IC (Spearman)",
        "months": len(ic),
        "avgNames": mean([len(rows) for _, rows in kept]) if kept else None,
        "from": kept[0][0] if kept else None,
        "to": kept[-1][0] if kept else None,
        "value": stats["mean"] if stats else None,
        "se": stats["se"] if stats else None,
        "tStat": stats["tStat"] if stats else None,
        "interval": interval,
        "baseline": {
            "label": "12-1 momentum IC",
            "value": base["mean"] if base else None,
            "difference": diff["mean"] if diff else None,
            "tStat": diff["tStat"] if diff else None,
        },
        "extras": [
            {"label": "Hit rate (IC > 0)", "value": len([v for v in ic if v > 0]) / len(ic) if ic else None, "format": "pct"},
            {"label": "Top − bottom third, after costs, annualized", "value": mean(net) * 12 if net else None, "format": "pct"},
            {"label": "Avg monthly turnover", "value": mean(turnover) if turnover else None, "format": "number"},
        ],
        "verdict": verdict,
    }


def score_vol_agent(output: AgentOutput) -> dict[str, Any]:
    months = _scored_months(output.predictions)
    gain: list[float] = []
    model: list[float] = []
    base: list[float] = []
    mse_model = 0.0
    mse_base = 0.0
    kept = []
    for month, rows in months:
        usable = [row for row in rows if row.realized > 0 and row.forecast > 0 and row.baseline > 0]  # type: ignore[operator]
        if len(usable) < MIN_SCORED_NAMES:
            continue
        loss_model = [qlike(row.realized**2, row.forecast**2) for row in usable]  # type: ignore[operator]
        loss_base = [qlike(row.realized**2, row.baseline**2) for row in usable]  # type: ignore[operator]
        for row in usable:
            mse_model += (row.realized**2 - row.forecast**2) ** 2  # type: ignore[operator]
            mse_base += (row.realized**2 - row.baseline**2) ** 2  # type: ignore[operator]
        model.append(mean(loss_model))
        base.append(mean(loss_base))
        gain.append(mean(loss_base) - mean(loss_model))
        kept.append((month, usable))
    stats = newey_west_mean(gain, SCORE_NW_LAG)
    interval = _mean_interval(gain)

    verdict = f"Only {len(gain)} scored months; too few to judge."
    if stats and len(gain) >= MIN_VERDICT_MONTHS:
        head = f"QLIKE {mean(model):.3f} against {mean(base):.3f} for trailing vol over {len(gain)} months (Diebold–Mariano t = {stats['tStat']:.2f})."
        body = (
            " HAR forecasts next month's vol better than last month's vol does."
            if stats["tStat"] >= 2
            else " HAR is worse than simply carrying last month's vol forward."
            if stats["tStat"] <= -2
            else " Not distinguishable from carrying last month's vol forward."
        )
        verdict = head + body

    return {
        **_base(output),
        "metric": "QLIKE gain over trailing vol",
        "months": len(gain),
        "avgNames": mean([len(rows) for _, rows in kept]) if kept else None,
        "from": kept[0][0] if kept else None,
        "to": kept[-1][0] if kept else None,
        "value": stats["mean"] if stats else None,
        "se": stats["se"] if stats else None,
        "tStat": stats["tStat"] if stats else None,
        "interval": interval,
        "baseline": {
            "label": "Trailing 22-session vol QLIKE",
            "value": mean(base) if base else None,
            "difference": stats["mean"] if stats else None,
            "tStat": stats["tStat"] if stats else None,
        },
        "extras": [
            {"label": "HAR QLIKE", "value": mean(model) if model else None, "format": "number"},
            {"label": "MSE vs trailing (ratio)", "value": mse_model / mse_base if mse_base > 0 else None, "format": "number"},
        ],
        "verdict": verdict,
    }


def score_agent(output: AgentOutput) -> dict[str, Any]:
    return score_vol_agent(output) if output.target == "vol" else score_return_agent(output)
