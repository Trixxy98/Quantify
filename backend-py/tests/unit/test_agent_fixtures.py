from dataclasses import asdict
from typing import Any

from app.research.agents.orchestrator import completed_month_end
from app.research.agents.risk_vol import run_risk_vol
from app.research.agents.scoreboard import score_agent
from app.research.agents.scoring import spearman
from app.research.agents.technical import run_technical
from app.research.agents.types import AgentInput, AgentOutput, AgentPrediction, SymbolSeries
from app.research.ridge import ridge
from tests.fixtures_util import check_module


def _input(raw: dict[str, Any]) -> AgentInput:
    return AgentInput(as_of=raw["asOf"], series=[SymbolSeries(**series) for series in raw["series"]])


def _output(raw: dict[str, Any]) -> AgentOutput:
    return AgentOutput(
        agent=raw["agent"],
        version=raw["version"],
        target=raw["target"],
        horizon=raw["horizon"],
        predictions=[AgentPrediction(**row) for row in raw["predictions"]],
        notes=raw["notes"],
    )


def _run(fn: Any) -> Any:
    return lambda raw: asdict(fn(_input(raw)))


REGISTRY = {
    "agents.runTechnical": _run(run_technical),
    "agents.runRiskVol": _run(run_risk_vol),
    "agents.scoreAgent": lambda raw: score_agent(_output(raw)),
    "agents.spearman": spearman,
    "agents.ridge": ridge,
    "agents.completedMonthEnd": completed_month_end,
}


def test_agents_match_typescript() -> None:
    # Ridge (scikit-learn) and HAR (statsmodels) replace hand-written solvers.
    check_module("agents", REGISTRY, rel=1e-6)
