"""Sentiment: next-month return rank from the net tone of headlines already recorded."""

import math

from app.research.agents.horizon import outcome_return
from app.research.agents.monthly import fresh_month, latest_month_ends, shift_month, symbol_months
from app.research.agents.tone import net_tone
from app.research.agents.types import Agent, AgentInput, AgentOutput, AgentPrediction

SENTIMENT_VERSION = "sentiment-tone-v1"
MIN_CROSS_SECTION = 5


def _titles(headlines: list[dict], symbol: str, start: str, end: str) -> list[str]:
    """Titles published after `start` and on or before `end`. `start` is the previous month end."""
    titles: list[str] = []
    for row in headlines:
        if row.get("symbol") != symbol:
            continue
        published = str(row.get("published", ""))[:10]
        if start < published <= end:
            title = row.get("title")
            if isinstance(title, str) and title:
                titles.append(title)
    return titles


def run_sentiment(data: AgentInput) -> AgentOutput:
    notes = [
        "Forecast = net tone of headlines published since the previous month end, read one session before the close. (positive − negative) / (positive + negative).",
        "Tone words are a short in-repo finance list. The Loughran–McDonald dictionary is not included.",
        "A name is scored only when a listed word appears. A month needs five such names. Baseline is zero.",
        "Forecasts start with the first recorded month. The decision book gives this agent no weight until 12 scored months exist.",
    ]
    headlines = data.headlines or []
    if not headlines:
        notes.append("No headlines on AgentInput. The sync records them forward; this page does not call Yahoo.")
        return AgentOutput("sentiment", SENTIMENT_VERSION, "returnScore", "1m", [], notes)

    us = [series for series in data.series if series.market == "US"]
    months = [symbol_months(series) for series in us]
    latest = latest_month_ends(months)
    as_of_month = data.as_of[:7]
    current = latest.get(as_of_month)
    if current is None or current < data.as_of:
        latest[as_of_month] = data.as_of

    predictions: list[AgentPrediction] = []
    for month in sorted(latest):
        rows: list[tuple[str, float, float | None]] = []
        for s, series in enumerate(us):
            now = fresh_month(months[s], month, latest)
            if now is None:
                continue
            previous = fresh_month(months[s], shift_month(month, -1), latest)
            start = previous.date if previous else "0000-01-01"
            tone = net_tone(_titles(headlines, series.symbol, start, series.dates[now.feature]))
            if tone is None:
                continue
            nxt = fresh_month(months[s], shift_month(month, 1), latest)
            realized = outcome_return(series, now.index, nxt.index if nxt else None, None)
            if realized is not None and not math.isfinite(realized):
                realized = None
            rows.append((series.symbol, tone, realized))
        if len(rows) < MIN_CROSS_SECTION:
            continue
        for symbol, tone, realized in rows:
            predictions.append(AgentPrediction(month, symbol, tone, 0.0, realized))

    if not predictions:
        notes.append(f"Need a month where at least {MIN_CROSS_SECTION} names have a positive or negative headline word.")
    return AgentOutput("sentiment", SENTIMENT_VERSION, "returnScore", "1m", predictions, notes)


sentiment_agent = Agent(name="sentiment", version=SENTIMENT_VERSION, target="returnScore", horizon="1m", run=run_sentiment)
