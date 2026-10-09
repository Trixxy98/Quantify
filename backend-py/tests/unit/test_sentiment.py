"""Tone scoring and the sentiment agent's first month. No database."""

from app.research.agents.decision import AgentView, agent_weights
from app.research.agents.monthly import symbol_months
from app.research.agents.orchestrator import run_agent_set
from app.research.agents.sentiment import sentiment_agent
from app.research.agents.tone import net_tone
from app.research.agents.types import AgentInput
from tests.unit.test_agents import synthetic


def test_net_tone_uses_whole_words() -> None:
    assert net_tone(["Company posts record profit"]) == 1
    assert net_tone(["Fraud probe and a loss"]) == -1
    assert net_tone(["Profit and a loss"]) == 0
    assert net_tone(["The board met on Tuesday"]) is None
    assert net_tone(["profitable quarter"]) is None


def test_sentiment_ranks_the_first_month_with_enough_headlines() -> None:
    data = synthetic(6, 80, seed=2)
    month = next(iter(symbol_months(data.series[0])))
    feature = data.series[0].dates[symbol_months(data.series[0])[month].feature]
    headlines = []
    for index, series in enumerate(data.series):
        word = "profit" if index < 3 else "fraud"
        headlines.append({"symbol": series.symbol, "published": feature, "title": f"{word} reported"})
    scored = sentiment_agent.run(AgentInput(data.as_of, data.series, headlines=headlines))
    assert scored.predictions, scored.notes
    by_symbol = {row.symbol: row.forecast for row in scored.predictions if row.month == month}
    assert by_symbol["S0"] == 1
    assert by_symbol["S5"] == -1
    assert run_agent_set([sentiment_agent], AgentInput(data.as_of, data.series, headlines=headlines))[0].ok


def test_sentiment_has_no_decision_weight_before_twelve_months() -> None:
    weights = agent_weights([AgentView("sentiment", {"A": 1.0}, [0.05] * 11)])
    assert weights["sentiment"] == 0
