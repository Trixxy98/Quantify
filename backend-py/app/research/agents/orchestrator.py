import math
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta

from pydantic import BaseModel, ValidationError, ValidationInfo, field_validator, model_validator

from app.research.agents.event import event_5d_agent, event_agent, event_vol_5d_agent, event_vol_agent
from app.research.agents.quant import quant_5d_agent, quant_agent, quant_prob_5d_agent, quant_prob_agent
from app.research.agents.risk_drawdown import risk_drawdown_5d_agent, risk_drawdown_agent
from app.research.agents.risk_vol import risk_vol_agent
from app.research.agents.sentiment import sentiment_agent
from app.research.agents.technical import technical_5d_agent, technical_agent
from app.research.agents.types import Agent, AgentInput, AgentOutput, AgentPrediction

# One entry per (name, target, horizon). Due-key is (name, model_version).
AGENTS: list[Agent] = [
    technical_agent,
    technical_5d_agent,
    quant_agent,
    quant_5d_agent,
    quant_prob_agent,
    quant_prob_5d_agent,
    event_agent,
    event_5d_agent,
    event_vol_agent,
    event_vol_5d_agent,
    risk_vol_agent,
    risk_drawdown_agent,
    risk_drawdown_5d_agent,
    sentiment_agent,
]


class _Prediction(BaseModel):
    month: str
    symbol: str
    forecast: float
    baseline: float
    realized: float | None

    @field_validator("month")
    @classmethod
    def _month(cls, value: str) -> str:
        if len(value) != 7 or value[4] != "-" or not (value[:4] + value[5:]).isdigit():
            raise ValueError("month must be YYYY-MM")
        return value

    @field_validator("symbol")
    @classmethod
    def _symbol(cls, value: str) -> str:
        if not value:
            raise ValueError("symbol is empty")
        return value

    @field_validator("forecast", "baseline", "realized")
    @classmethod
    def _finite(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("Number must be finite")
        return value


class _Output(BaseModel):
    """Validated against the agent and input passed in the validation context."""

    agent: str
    version: str
    target: str
    horizon: str
    predictions: list[_Prediction]
    notes: list[str]

    @model_validator(mode="after")
    def _rows(self, info: ValidationInfo) -> "_Output":
        context = info.context or {}
        agent: Agent = context["agent"]
        data: AgentInput = context["input"]
        for name in ("agent", "version", "target", "horizon"):
            expected = agent.name if name == "agent" else getattr(agent, name)
            if getattr(self, name) != expected:
                raise ValueError(f"{name}: expected {expected!r}")
        universe = {series.symbol for series in data.series}
        as_of_month = data.as_of[:7]
        seen: set[str] = set()
        for index, row in enumerate(self.predictions):
            where = f"predictions.{index}"
            if row.symbol not in universe:
                raise ValueError(f"{where}: {row.symbol} is not in the universe")
            if row.month > as_of_month:
                raise ValueError(f"{where}: {row.month} is after {data.as_of}")
            if row.month == as_of_month and row.realized is not None:
                raise ValueError(f"{where}: {row.symbol} {row.month} has an outcome that cannot be known yet")
            if agent.target == "vol" and not row.forecast > 0:
                raise ValueError(f"{where}: {row.symbol} {row.month} vol forecast is not positive")
            if agent.target in ("probBeatMedian", "probDrawdown") and not 0.0 <= row.forecast <= 1.0:
                raise ValueError(f"{where}: {row.symbol} {row.month} probability is outside [0, 1]")
            key = f"{row.month}|{row.symbol}"
            if key in seen:
                raise ValueError(f"{where}: duplicate forecast for {row.symbol} {row.month}")
            seen.add(key)
        return self


@dataclass
class AgentResult:
    agent: str
    version: str
    ok: bool
    output: AgentOutput | None = None
    live: list[AgentPrediction] | None = None
    error: str | None = None


def run_agent_set(agents: list[Agent], data: AgentInput) -> list[AgentResult]:
    """Runs each agent on the same input and validates what it returns. A throw or malformed output fails that agent only."""
    as_of_month = data.as_of[:7]
    results = []
    for agent in agents:
        try:
            output = agent.run(data)
            payload = {**asdict(output), "predictions": [asdict(row) for row in output.predictions]}
            _Output.model_validate(payload, context={"agent": agent, "input": data})
        except ValidationError as err:
            first = err.errors()[0]
            location = ".".join(str(part) for part in first.get("loc", ()))
            where = f" at {location}" if location else ""
            message = str(first.get("msg", "invalid")).removeprefix("Value error, ")
            results.append(AgentResult(agent.name, agent.version, False, error=f"invalid output{where}: {message}"))
            continue
        except Exception as err:
            results.append(AgentResult(agent.name, agent.version, False, error=str(err)))
            continue
        results.append(AgentResult(agent.name, agent.version, True, output, [row for row in output.predictions if row.month == as_of_month]))
    return results


def _next_weekday(day: str) -> str:
    current = date.fromisoformat(day) + timedelta(days=1)
    while current.weekday() >= 5:
        current += timedelta(days=1)
    return current.isoformat()


def completed_month_end(calendar: list[str], latest_closed_session: str) -> str | None:
    """
    Last session of the latest month whose bars are all in. The last stored
    month counts only if its final bar is the month's last weekday and that
    session has closed; otherwise a later bar proves the month before it complete.
    """
    if not calendar:
        return None
    last = calendar[-1]
    if _next_weekday(last)[:7] != last[:7] and last <= latest_closed_session:
        return last
    month = last[:7]
    for day in reversed(calendar):
        if day[:7] < month:
            return day
    return None


@dataclass
class AgentRunState:
    agent: str
    model_version: str
    ok: bool
    started_at: datetime
    finished_at: datetime | None


def agents_due(agents: list[Agent], runs: list[AgentRunState], now: datetime, in_flight: timedelta) -> list[Agent]:
    """Due if this (agent name, model version) has no success for asOf and is not in flight."""
    due = []
    for agent in agents:
        mine = [run for run in runs if run.agent == agent.name and run.model_version == agent.version]
        if any(run.ok for run in mine):
            continue
        if any(run.finished_at is None and now - run.started_at < in_flight for run in mine):
            continue
        due.append(agent)
    return due
