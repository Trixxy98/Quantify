import math
from dataclasses import replace
from datetime import date, datetime, timedelta

import pytest

from app.research.agents.monthly import month_distance, shift_month, symbol_months
from app.research.agents.orchestrator import AgentRunState, agents_due, run_agent_set
from app.research.agents.risk_vol import (
    HAR_MIN_TRAIN_MONTHS,
    HarRow,
    fit_har,
    har_forecast,
    har_rows,
    risk_vol_agent,
    run_risk_vol,
)
from app.research.agents.scoreboard import score_return_agent
from app.research.agents.scoring import qlike, rank_score, ranks, spearman
from app.research.agents.technical import run_technical, technical_agent, technical_features
from app.research.agents.types import Agent, AgentInput, AgentOutput, SymbolSeries
from app.research.bootstrap import seeded_random
from app.research.ridge import ridge
from app.research.walk_forward import Fold, expanding_folds

SESSIONS = 2100  # about 100 months: 13 of warm-up, 60 of training, the rest out of sample


def _gaussian(random) -> float:  # type: ignore[no-untyped-def]
    u = max(random(), 1e-12)
    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * random())


def weekdays(start: str, count: int) -> list[str]:
    out: list[str] = []
    day = date.fromisoformat(start)
    while len(out) < count:
        if day.weekday() < 5:
            out.append(day.isoformat())
        day += timedelta(days=1)
    return out


def synthetic(names: int, sessions: int, seed: int, persistent_drift: bool = False) -> AgentInput:
    """Daily bars with mean-reverting monthly vol; with a persistent drift, past returns predict the next month."""
    random = seeded_random(seed)
    dates = weekdays("2015-01-01", sessions)
    series = []
    for s in range(names):
        level = 100.0
        drift = (random() - 0.5) * 0.01 if persistent_drift else 0.0
        base_vol = 0.01 + 0.01 * random()
        vol = base_vol
        o, h, lo, c = [], [], [], []
        for i in range(len(dates)):
            if i % 21 == 0:
                vol = math.exp(0.7 * math.log(vol) + 0.3 * math.log(base_vol) + 0.3 * _gaussian(random))
            prev = level
            level = prev * math.exp(drift + vol * _gaussian(random))
            spread = vol * (0.5 + random())
            o.append(prev)
            c.append(level)
            h.append(max(prev, level) * (1 + spread / 2))
            lo.append(min(prev, level) * (1 - spread / 2))
        series.append(SymbolSeries(f"S{s}", "US", list(dates), o, h, lo, c, list(c)))
    return AgentInput(as_of=dates[-1], series=series)


def perturb_after(data: AgentInput, month: str) -> AgentInput:
    out = []
    for series in data.series:
        feature = symbol_months(series)[month].feature

        def bump(values: list[float], scale: float, cut: int = feature) -> list[float]:
            return [value * (1 + scale * math.sin(i)) if i > cut else value for i, value in enumerate(values)]

        out.append(replace(series, high=bump(series.high, 0.05), level=bump(series.level, 0.2)))
    return AgentInput(data.as_of, out)


def shift_one_session(data: AgentInput) -> AgentInput:
    def lag(values: list[float]) -> list[float]:
        return [values[0], *values[:-1]]

    return AgentInput(
        data.as_of,
        [replace(s, open=lag(s.open), high=lag(s.high), low=lag(s.low), close=lag(s.close), level=lag(s.level)) for s in data.series],
    )


def forecasts_up_to(output: AgentOutput, month: str) -> dict[str, float]:
    return {f"{row.month}|{row.symbol}": row.forecast for row in output.predictions if row.month <= month}


def test_scoring_basics() -> None:
    assert ranks([10, 20, 20, 5]) == [2, 3.5, 3.5, 1]
    a = [0.1, -0.2, 0.05, 0.3, -0.1]
    assert spearman(a, [v * 7 + 1 for v in a]) == pytest.approx(1)
    assert spearman(a, [-v for v in a]) == pytest.approx(-1)
    assert rank_score([3, 1, 2]) == [0.5, -0.5, 0]
    assert qlike(0.04, 0.04) == pytest.approx(0)
    assert qlike(0.04, 0.02) > 0


def test_ridge_shrinks() -> None:
    random = seeded_random(9)
    x = [[random() - 0.5, random() - 0.5, random() - 0.5] for _ in range(200)]
    y = [2 * r[0] - r[1] + 0.5 * r[2] for r in x]
    assert ridge(x, y, 0) == pytest.approx([2, -1, 0.5])
    assert math.hypot(*ridge(x, y, 1)) < math.hypot(*ridge(x, y, 0.01))


def test_expanding_folds_keep_short_last_fold() -> None:
    assert expanding_folds(11, 4, 3) == [Fold(0, 4, 4, 7), Fold(0, 7, 7, 10), Fold(0, 10, 10, 11)]
    assert expanding_folds(4, 4, 3) == []


def test_month_helpers() -> None:
    assert shift_month("2026-01", -1) == "2025-12"
    assert shift_month("2025-11", 3) == "2026-02"
    assert month_distance("2025-11", "2026-02") == 3


class TestTechnical:
    data = synthetic(12, SESSIONS, 11)
    output = run_technical(data)
    months = sorted({row.month for row in output.predictions})
    middle = months[len(months) // 2]

    def test_reads_the_session_before_the_close(self) -> None:
        series = self.data.series[0]
        months = symbol_months(series)
        month = list(months)[40]
        end = months[month]
        before = technical_features(series, months, month)
        at_close = replace(series, level=[v * 1.5 if i == end.index else v for i, v in enumerate(series.level)])
        assert technical_features(at_close, months, month) == before
        at_feature = replace(series, level=[v * 1.5 if i == end.feature else v for i, v in enumerate(series.level)])
        assert technical_features(at_feature, months, month) != before

    def test_future_prices_never_change_a_forecast(self) -> None:
        a = forecasts_up_to(self.output, self.middle)
        b = forecasts_up_to(run_technical(perturb_after(self.data, self.middle)), self.middle)
        assert b.keys() == a.keys()
        for key, value in a.items():
            assert b[key] == pytest.approx(value, rel=1e-12, abs=1e-15)

    def test_shifted_prices_do_change_it(self) -> None:
        a = forecasts_up_to(self.output, self.middle)
        b = forecasts_up_to(run_technical(shift_one_session(self.data)), self.middle)
        assert any(key in b and abs(b[key] - value) > 1e-9 for key, value in a.items())

    def test_finds_skill_when_past_returns_predict(self) -> None:
        score = score_return_agent(run_technical(synthetic(20, SESSIONS, 4, persistent_drift=True)))
        assert score["months"] > 12
        assert score["value"] > 0.1
        assert "Evidence of ranking skill" in score["verdict"]


class TestRiskVol:
    data = synthetic(6, SESSIONS, 13)
    output = run_risk_vol(data)
    months = sorted({row.month for row in output.predictions})
    middle = months[len(months) // 2]

    def test_recovers_known_har_coefficients(self) -> None:
        random = seeded_random(21)
        samples = []
        for i in range(400):
            x = (random() * 4e-4, random() * 4e-4, random() * 4e-4)
            samples.append(HarRow(i, x, 2e-5 + 0.1 * x[0] + 0.3 * x[1] + 0.5 * x[2] + (random() - 0.5) * 1e-7))
        fit = fit_har(samples)
        assert fit is not None
        assert fit.beta == pytest.approx([2e-5, 0.1, 0.3, 0.5], abs=1e-3)
        assert har_forecast(fit, (0, 0, 0)) >= fit.floor

    def test_daily_rows_span_the_next_22_sessions(self) -> None:
        series = synthetic(1, 300, 2).series[0]
        rows = har_rows(series)
        assert len(rows) == 300 - 21 - 22
        assert all(row.target_end < len(series.dates) for row in rows)

    def test_positive_forecasts_and_unscored_newest_month(self) -> None:
        assert self.output.predictions and all(row.forecast > 0 for row in self.output.predictions)
        assert all(row.realized is None for row in self.output.predictions if row.month == self.months[-1])
        assert HAR_MIN_TRAIN_MONTHS == 60

    def test_future_bars_never_change_a_forecast(self) -> None:
        a = forecasts_up_to(self.output, self.middle)
        b = forecasts_up_to(run_risk_vol(perturb_after(self.data, self.middle)), self.middle)
        assert b.keys() == a.keys()
        for key, value in a.items():
            assert b[key] == pytest.approx(value, rel=1e-12)

    def test_shifted_bars_do_change_it(self) -> None:
        a = forecasts_up_to(self.output, self.middle)
        b = forecasts_up_to(run_risk_vol(shift_one_session(self.data)), self.middle)
        assert any(key in b and abs(b[key] - value) > 1e-12 for key, value in a.items())


class TestOrchestrator:
    data = synthetic(8, SESSIONS, 17)
    as_of_month = data.as_of[:7]

    def _bad(self, change) -> Agent:  # type: ignore[no-untyped-def]
        return replace(technical_agent, run=lambda data: change(technical_agent.run(data)))

    def test_rejects_malformed_output_and_runs_the_rest(self) -> None:
        def nan_first(output: AgentOutput) -> AgentOutput:
            output.predictions[0] = replace(output.predictions[0], forecast=math.nan)
            return output

        def stranger(output: AgentOutput) -> AgentOutput:
            output.predictions.append(replace(output.predictions[0], symbol="ZZZZ"))
            return output

        def peeking(output: AgentOutput) -> AgentOutput:
            output.predictions = [replace(row, realized=0.01) if row.month == self.as_of_month else row for row in output.predictions]
            return output

        def boom(_data: AgentInput) -> AgentOutput:
            raise RuntimeError("boom")

        agents = [self._bad(nan_first), self._bad(stranger), self._bad(peeking), replace(technical_agent, run=boom), risk_vol_agent]
        results = run_agent_set(agents, self.data)
        assert [result.ok for result in results] == [False, False, False, False, True]
        assert results[3].error == "boom"
        assert results[4].live and all(row.month == self.as_of_month for row in results[4].live)

    def test_second_pass_for_the_same_month_does_nothing(self) -> None:
        now = datetime(2026, 10, 3)
        hour = timedelta(hours=1)
        agents = [technical_agent, risk_vol_agent]
        assert [a.name for a in agents_due(agents, [], now, hour)] == ["technical", "risk"]
        done = [AgentRunState("technical", True, now, now), AgentRunState("risk", True, now, now)]
        assert agents_due(agents, done, now, hour) == []

    def test_retries_failed_and_dead_runs_but_not_running_ones(self) -> None:
        now = datetime(2026, 10, 3, 12)
        hour = timedelta(hours=1)
        runs = [
            AgentRunState("technical", False, now - timedelta(minutes=10), None),
            AgentRunState("risk", False, now - timedelta(hours=3), None),
        ]
        assert [a.name for a in agents_due([technical_agent, risk_vol_agent], runs, now, hour)] == ["risk"]
        assert [a.name for a in agents_due([technical_agent], [AgentRunState("technical", False, now, now)], now, hour)] == ["technical"]
