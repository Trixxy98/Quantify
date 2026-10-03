from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

AgentName = Literal["technical", "risk"]
AgentTarget = Literal["returnScore", "vol"]
AgentHorizon = Literal["1m"]


@dataclass
class SymbolSeries:
    """One symbol's daily bars, ascending, already cut at the orchestrator's asOf."""

    symbol: str
    market: Literal["US", "BURSA"]
    dates: list[str]
    open: list[float]
    high: list[float]
    low: list[float]
    close: list[float]
    level: list[float]  # total-return index, dividends reinvested on the ex-date


@dataclass
class AgentInput:
    as_of: str  # last session of the latest complete month; nothing after it is in `series`
    series: list[SymbolSeries]


@dataclass
class AgentPrediction:
    """One out-of-sample forecast for the month after `month`. `realized` is None for the live month."""

    month: str
    symbol: str
    forecast: float
    baseline: float
    realized: float | None


@dataclass
class AgentOutput:
    agent: str
    version: str
    target: str
    horizon: str
    predictions: list[AgentPrediction]
    notes: list[str] = field(default_factory=list)


@dataclass
class Agent:
    name: AgentName
    version: str
    target: AgentTarget
    horizon: AgentHorizon
    # Pure: no I/O, and nothing outside the input may be read.
    run: Callable[[AgentInput], AgentOutput]
