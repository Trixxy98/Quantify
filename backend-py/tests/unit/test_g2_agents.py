"""Synthetic checks for G2: logistic, Quant, Event, Risk drawdown. No database."""

import math
from datetime import datetime, timedelta

import pytest

from app.research.agents.event import event_agent, event_vol_agent
from app.research.agents.horizon import dates_ahead, next_n_return
from app.research.agents.orchestrator import AGENTS, AgentRunState, agents_due, run_agent_set
from app.research.agents.quant import quant_5d_agent, quant_agent, quant_prob_agent
from app.research.agents.risk_drawdown import risk_drawdown_agent
from app.research.agents.types import AgentInput, SymbolSeries
from app.research.french import FACTOR_NAMES
from app.research.logistic import brier_skill_score, logistic, predict_proba
from tests.unit.test_agents import synthetic


def _factors(dates: list[str]) -> dict[str, dict[str, float]]:
    """Distinct daily factor paths so the FF regression is not collinear."""
    out: dict[str, dict[str, float]] = {}
    for i, day in enumerate(dates):
        row = {"RF": 0.00005}
        for k, name in enumerate(FACTOR_NAMES):
            row[name] = 0.001 * math.sin((i + 1) / (2.5 + k))
        out[day] = row
    return out


def _with_spy(data: AgentInput) -> AgentInput:
    base = data.series[0]
    spy = SymbolSeries("SPY", "US", list(base.dates), list(base.open), list(base.high), list(base.low), list(base.close), list(base.level))
    # A handful of months drop more than 5% so both drawdown classes exist.
    level = list(spy.level)
    for i in range(40, len(level), 126):
        level[i] = level[i - 1] * 0.92
        for j in range(i + 1, min(i + 15, len(level))):
            level[j] = level[j - 1] * 1.002
    spy = SymbolSeries("SPY", "US", spy.dates, spy.open, spy.high, spy.low, [level[i] for i in range(len(level))], level)
    return AgentInput(data.as_of, [*data.series, spy], data.factors, data.events)


def test_logistic_separates_a_clean_split() -> None:
    fit = logistic([0, 0, 1, 1], [[-2.0], [-1.0], [1.0], [2.0]])
    probs = predict_proba(fit["beta"], [[-2.0], [-1.0], [1.0], [2.0]])
    assert probs[0] < 0.05
    assert probs[-1] > 0.95
    assert fit["beta"][1] > 0


def test_logistic_rejects_a_single_class() -> None:
    with pytest.raises(ValueError, match="one class"):
        logistic([1, 1, 1], [[0.0], [1.0], [2.0]])


def test_brier_skill_rewards_a_better_forecast() -> None:
    outcomes = [0, 0, 1, 1]
    assert brier_skill_score([0.0, 0.0, 1.0, 1.0], outcomes) > 0.9
    assert brier_skill_score([0.5, 0.5, 0.5, 0.5], outcomes) == pytest.approx(0.0, abs=1e-9)


def test_quant_emits_ranks_and_probabilities() -> None:
    data = synthetic(8, 2100, seed=3)
    dates = data.series[0].dates
    data = AgentInput(data.as_of, data.series, _factors(dates), None)
    rank = quant_agent.run(data)
    prob = quant_prob_agent.run(data)
    assert rank.predictions, rank.notes
    assert prob.predictions, prob.notes
    live = data.as_of[:7]
    assert all(row.month <= live for row in rank.predictions)
    assert all(row.realized is None for row in rank.predictions if row.month == live)
    assert all(0.0 <= row.forecast <= 1.0 for row in prob.predictions)
    assert all(row.baseline == 0.5 for row in prob.predictions)
    results = run_agent_set([quant_agent, quant_prob_agent], data)
    assert [row.ok for row in results] == [True, True]


def test_earnings_dates_apply_only_to_that_symbol() -> None:
    data = synthetic(6, 2100, seed=11)
    # Five names share a month of filings; the sixth is left out and must not be scored.
    included = data.series[:5]
    events = [{"date": f"{day[:7]}-10", "type": "EARNINGS", "symbol": series.symbol} for series in included for day in series.dates[::21]]
    data = AgentInput(data.as_of, data.series, None, events)
    output = event_agent.run(data)
    assert output.predictions, output.notes
    assert data.series[5].symbol not in {row.symbol for row in output.predictions}


def test_event_uses_only_scheduled_types() -> None:
    data = synthetic(6, 2100, seed=5)
    events = [{"date": day, "type": "FOMC", "symbol": None} for day in data.series[0].dates if day.endswith("-15")]
    data = AgentInput(data.as_of, data.series, None, events)
    rank = event_agent.run(data)
    vol = event_vol_agent.run(data)
    assert rank.predictions, rank.notes
    assert vol.predictions, vol.notes
    assert {row.symbol for row in rank.predictions} <= {series.symbol for series in data.series}
    results = run_agent_set([event_agent, event_vol_agent], data)
    assert all(row.ok for row in results)


def test_risk_drawdown_probability_is_a_market_forecast() -> None:
    data = _with_spy(synthetic(6, 2100, seed=7))
    output = risk_drawdown_agent.run(data)
    assert output.predictions, output.notes
    assert {row.symbol for row in output.predictions} == {"SPY"}
    assert all(0.0 <= row.forecast <= 1.0 for row in output.predictions)
    scored = [row for row in output.predictions if row.realized is not None]
    assert {row.realized for row in scored} <= {0.0, 1.0}
    assert run_agent_set([risk_drawdown_agent], data)[0].ok


def test_five_session_quant_is_scored_on_a_shorter_window() -> None:
    data = synthetic(8, 2100, seed=11)
    data = AgentInput(data.as_of, data.series, _factors(data.series[0].dates))
    monthly = quant_agent.run(data)
    weekly = quant_5d_agent.run(data)
    assert weekly.horizon == "5d"
    assert weekly.version != monthly.version
    scored = [row for row in weekly.predictions if row.realized is not None]
    assert scored
    sample = scored[0]
    series = next(series for series in data.series if series.symbol == sample.symbol)
    index = max(i for i, day in enumerate(series.dates) if day.startswith(sample.month))
    assert sample.realized == pytest.approx(next_n_return(series, index))
    versions = {agent.version for agent in AGENTS}
    assert quant_5d_agent.version in versions
    assert len(AGENTS) == 14


def test_dates_ahead_is_the_next_five_sessions() -> None:
    data = synthetic(1, 30, seed=1)
    assert len(dates_ahead(data.series[0], 0)) == 5


def test_same_agent_name_with_a_new_version_is_still_due() -> None:
    now = datetime(2026, 10, 3)
    hour = timedelta(hours=1)
    done = [AgentRunState("quant", quant_agent.version, True, now, now)]
    due = agents_due([quant_agent, quant_prob_agent], done, now, hour)
    assert [agent.version for agent in due] == [quant_prob_agent.version]
