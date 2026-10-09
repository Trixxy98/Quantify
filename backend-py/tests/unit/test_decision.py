"""Decision rules on synthetic scores. No database and no model fit."""

from app.research.agents.decision import AgentView, decide, evaluate, forecast_correlation
from app.research.agents.types import AgentOutput, AgentPrediction


def _ics(value: float, months: int = 12) -> list[float]:
    return [value] * months


def _flat(symbols: list[str], hot: str, hot_score: float = 5.0) -> dict[str, float]:
    return {symbol: hot_score if symbol == hot else 0.0 for symbol in symbols}


def test_negative_ic_gets_zero_weight_and_positive_weights_sum_to_one() -> None:
    symbols = ["A", "B", "C", "D", "E", "F"]
    agents = [
        AgentView("technical", _flat(symbols, "A"), _ics(0.10)),
        AgentView("quant", _flat(symbols, "A"), _ics(-0.04)),
        AgentView("event", _flat(symbols, "A"), _ics(0.02, months=11)),
    ]
    decision = decide(agents, {symbol: 0.20 for symbol in symbols}, None, [], "2026-09")
    assert decision.weights["quant"] == 0
    assert decision.weights["event"] == 0
    assert decision.weights["technical"] == 1
    held = [row for row in decision.rows if row.action == "hold"]
    cash = [row for row in decision.rows if row.action == "cash"]
    assert abs(sum(row.weight for row in held + cash) - 1) < 1e-9
    assert held and held[0].symbol == "A"


def test_weights_shrink_halfway_toward_equal() -> None:
    symbols = ["A", "B", "C", "D", "E", "F"]
    agents = [
        AgentView("technical", _flat(symbols, "A"), _ics(0.10)),
        AgentView("event", _flat(symbols, "A"), _ics(0.02)),
    ]
    decision = decide(agents, {symbol: 0.20 for symbol in symbols}, None, [], "2026-09")
    # Raw shares 10/12 and 2/12, then halfway to 1/2.
    assert abs(decision.weights["technical"] - (0.5 * (0.10 / 0.12) + 0.5 * 0.5)) < 1e-9
    assert abs(decision.weights["event"] - (0.5 * (0.02 / 0.12) + 0.5 * 0.5)) < 1e-9
    assert abs(sum(decision.weights.values()) - 1) < 1e-9


def test_conflict_skips_a_top_name_most_of_the_weight_ranks_low() -> None:
    symbols = ["A", "B", "C", "D", "E", "F"]
    # The light agent spikes A. The two heavier agents rank A last, so it stays in the
    # combined top third only because the spike is extreme, and agreement is under half.
    light = {symbol: 0.0 for symbol in symbols}
    light["A"] = 100.0
    heavy_b = {symbol: 1.0 for symbol in symbols}
    heavy_b["A"] = -5.0
    heavy_b["B"] = 3.0
    heavy_c = {symbol: 1.0 for symbol in symbols}
    heavy_c["A"] = -5.0
    heavy_c["C"] = 3.0
    agents = [
        AgentView("technical", light, _ics(0.02)),
        AgentView("quant", heavy_b, _ics(0.04)),
        AgentView("event", heavy_c, _ics(0.04)),
    ]
    decision = decide(agents, {symbol: 0.20 for symbol in symbols}, None, [], "2026-09")
    skipped = {row.symbol: row for row in decision.rows if row.action == "skip"}
    assert {"B", "C"} <= set(skipped)
    assert all("disagree" in row.reason and row.weight == 0 for row in skipped.values())
    assert not [row for row in decision.rows if row.action == "hold"]
    cash = next(row for row in decision.rows if row.symbol == "CASH")
    assert abs(cash.weight - 1) < 1e-9


def test_high_drawdown_probability_halves_exposure() -> None:
    symbols = ["A", "B", "C", "D", "E", "F"]
    agents = [AgentView("technical", _flat(symbols, "A", 2), _ics(0.05))]
    history = [0.10] * 12
    decision = decide(agents, {symbol: 0.20 for symbol in symbols}, 0.40, history, "2026-09")
    held = [row for row in decision.rows if row.action == "hold"]
    cash = next(row for row in decision.rows if row.symbol == "CASH")
    assert abs(sum(row.weight for row in held) - 0.5) < 1e-9
    assert abs(cash.weight - 0.5) < 1e-9
    assert "halved" in cash.reason
    assert "risk-limit" in cash.rules


def test_equity_charges_costs_and_marks_the_book() -> None:
    symbols = ["A", "B", "C", "D", "E", "F"]
    predictions: list[AgentPrediction] = []
    vols: list[AgentPrediction] = []
    for index in range(13):
        year, month_number = divmod(index, 12)
        month = f"{2020 + year}-{month_number + 1:02d}"
        for symbol in symbols:
            predictions.append(AgentPrediction(month, symbol, 1.0 if symbol == "A" else 0.0, 0.0, 0.10 if symbol == "A" else 0.0))
            vols.append(AgentPrediction(month, symbol, 0.20, 0.20, None))
    ranked = AgentOutput("technical", "technical-ridge-v1", "returnScore", "1m", predictions, [])
    risk = AgentOutput("risk", "risk-har-v1", "vol", "1m", vols, [])
    curve = evaluate([ranked, risk], {"2021-01": 0.01})
    points = curve["equity"]
    assert isinstance(points, list)
    last = points[-1]
    # Twelve prior months unlock the book. The tied names are not above the median, so only A is held.
    # Entering from cash turns the whole book over: 10 bps off A's 10%.
    assert last["month"] == "2021-01"
    assert abs(float(last["strategy"]) - 100 * (1 + 0.10 - 0.001)) < 1e-6
    assert last["benchmark"] is not None


def test_identical_return_ranks_correlate_at_one() -> None:
    symbols = ["A", "B", "C", "D", "E", "F"]
    shared = [AgentPrediction("2020-01", symbol, float(index), 0.0, None) for index, symbol in enumerate(symbols)]
    flipped = [AgentPrediction("2020-01", symbol, float(len(symbols) - index), 0.0, None) for index, symbol in enumerate(symbols)]
    technical = AgentOutput("technical", "t", "returnScore", "1m", shared, [])
    quant = AgentOutput("quant", "q", "returnScore", "1m", shared, [])
    event = AgentOutput("event", "e", "returnScore", "1m", flipped, [])
    matrix = forecast_correlation([technical, quant, event])
    pairs = { (row["left"], row["right"]): row for row in matrix["pairs"] }  # type: ignore[union-attr]
    assert pairs[("technical", "quant")]["mean"] == 1
    assert pairs[("technical", "event")]["mean"] == -1
    assert pairs[("quant", "event")]["latestMonth"] == "2020-01"
