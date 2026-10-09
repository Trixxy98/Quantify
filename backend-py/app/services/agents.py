import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import Float, cast, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.jobs.market_session import latest_session
from app.jobs.state import finish_agents, try_start_agents
from app.models import (
    AgentDecision,
    AgentForecast,
    AgentRun,
    BenchmarkPrice,
    DailyPrice,
    FactorReturn,
    NewsHeadline,
    new_id,
    table_of,
)
from app.research.agents.decision import decide_from_outputs
from app.research.agents.orchestrator import AGENTS, AgentRunState, agents_due, completed_month_end, run_agent_set
from app.research.agents.scoreboard import score_agent
from app.research.agents.technical import MIN_TRAIN_MONTHS
from app.research.agents.types import AgentInput, SymbolSeries
from app.services.corporate_actions import load_dividends
from app.services.earnings import load_earnings_events, record_earnings
from app.services.events import load_macro
from app.services.market import get_tracked_symbols, sync_daily_prices
from app.services.momentum import build_level
from app.timeutil import date_key, iso, utcnow

log = logging.getLogger("quantify")
BASKET = json.loads((Path(__file__).resolve().parents[1] / "data" / "momentumBasket.json").read_text())
HISTORY_FROM = datetime(2015, 1, 1)
# A run unfinished after this long is assumed dead, as for SyncRun.
AGENT_IN_FLIGHT = timedelta(hours=1)
REFRESH_WORKERS = 3
INDEX_VIEW_SYMBOLS = ("SPY",)
DECISION_AGENTS = [
    agent
    for agent in AGENTS
    if agent.horizon == "1m" and (agent.target == "returnScore" or (agent.name == "risk" and agent.target in ("vol", "probDrawdown")))
]

AGENT_INFO = {
    "technical": {
        "label": "Technical",
        "description": "Ranks next month's US returns from 1, 3 and 6-month returns, 12-1 momentum and distance from the 200-day mean.",
    },
    "quant": {
        "label": "Quant",
        "description": "FF5+Mom loadings × trailing factor premia: return rank and P(beat the cross-sectional median). Includes SPY.",
    },
    "event": {
        "label": "Event",
        "description": "Mean past abnormal move for FOMC/CPI/earnings types scheduled in the next month (return rank and vol uplift).",
    },
    "risk": {
        "label": "Risk",
        "description": "HAR next-month vol per name, plus P(market drawdown ≤ −5% peak-to-trough) on SPY/^GSPC.",
    },
}


def agent_universe(db: Session) -> list[str]:
    """Basket + every traded name + SPY for the index view."""
    symbols = {*BASKET["symbols"], *get_tracked_symbols(db), *INDEX_VIEW_SYMBOLS}
    return sorted(symbol for symbol in symbols if not symbol.startswith("^"))


def _us_calendar(db: Session) -> list[str]:
    rows = db.scalars(select(BenchmarkPrice.date).where(BenchmarkPrice.symbol == "^GSPC", BenchmarkPrice.date >= HISTORY_FROM.date()).order_by(BenchmarkPrice.date)).all()
    return [date_key(day) for day in rows]


def current_as_of(db: Session, now: datetime) -> str | None:
    return completed_month_end(_us_calendar(db), latest_session(now, "US").date)


def _refresh_universe(db: Session, symbols: list[str], through: str) -> list[str]:
    """
    Basket names are not synced daily, only when a page needs them. Before a
    month-end pass, deepen any name lacking history and bring stale ones up to `through`.
    """
    spans = {
        row.symbol: (row.first, row.last)
        for row in db.execute(
            select(DailyPrice.symbol, func.min(DailyPrice.date).label("first"), func.max(DailyPrice.date).label("last"))
            .where(DailyPrice.symbol.in_(symbols))
            .group_by(DailyPrice.symbol)
        ).all()
    }
    deepen_before = HISTORY_FROM.date() + timedelta(days=31)
    jobs: list[tuple[str, datetime]] = []
    for symbol in symbols:
        span = spans.get(symbol)
        if span is None or span[0] > deepen_before:
            jobs.append((symbol, HISTORY_FROM))
        elif date_key(span[1]) < through:
            last = span[1]
            jobs.append((symbol, datetime(last.year, last.month, last.day) - timedelta(days=7)))

    failed: list[str] = []

    def work(job: tuple[str, datetime]) -> None:
        try:
            with SessionLocal() as own:
                sync_daily_prices(own, job[0], job[1])
        except Exception:
            log.exception("[agents] price refresh failed %s", job[0])
            failed.append(job[0])

    if jobs:
        with ThreadPoolExecutor(max_workers=min(REFRESH_WORKERS, len(jobs))) as pool:
            list(pool.map(work, jobs))
    return failed


def load_agent_input(db: Session, as_of: str, symbols: list[str]) -> AgentInput:
    """Bars from 2015 through `as_of` with a dividend-reinvested level. Nothing after `as_of` is loaded."""
    # float8 from Postgres: numeric(18,6) converts exactly as Number(decimal) does, without 400k Decimal objects.
    rows = db.execute(
        select(
            DailyPrice.symbol,
            DailyPrice.date,
            cast(DailyPrice.open, Float).label("open"),
            cast(DailyPrice.high, Float).label("high"),
            cast(DailyPrice.low, Float).label("low"),
            cast(DailyPrice.close, Float).label("close"),
        )
        .where(DailyPrice.symbol.in_(symbols), DailyPrice.date >= HISTORY_FROM.date(), DailyPrice.date <= date.fromisoformat(as_of))
        .order_by(DailyPrice.symbol, DailyPrice.date)
    ).all()
    dividends = load_dividends(db, symbols)
    bars: dict[str, list[Any]] = {}
    for row in rows:
        bars.setdefault(row.symbol, []).append(row)
    series = []
    for symbol, symbol_rows in bars.items():
        dates = [date_key(row.date) for row in symbol_rows]
        close = [float(row.close) for row in symbol_rows]
        income = [{"date": date_key(row.ex_date), "amount": row.amount} for row in dividends.get(symbol, [])]
        series.append(
            SymbolSeries(
                symbol=symbol,
                market="BURSA" if symbol.endswith(".KL") else "US",
                dates=dates,
                open=[float(row.open) for row in symbol_rows],
                high=[float(row.high) for row in symbol_rows],
                low=[float(row.low) for row in symbol_rows],
                close=close,
                level=[point["level"] for point in build_level([{"date": d, "close": c} for d, c in zip(dates, close, strict=True)], income)],
            )
        )
    return AgentInput(as_of=as_of, series=series, factors=_load_factors(db, as_of), events=_load_events(db, as_of, symbols))


def _load_factors(db: Session, as_of: str) -> dict[str, dict[str, float]]:
    rows = db.execute(
        select(FactorReturn.date, FactorReturn.factor, FactorReturn.value).where(
            FactorReturn.date >= HISTORY_FROM.date(),
            FactorReturn.date <= date.fromisoformat(as_of),
        )
    ).all()
    out: dict[str, dict[str, float]] = {}
    for row in rows:
        out.setdefault(date_key(row.date), {})[row.factor] = float(row.value)
    return out


def _load_events(db: Session, as_of: str, symbols: list[str]) -> list[dict[str, Any]]:
    """Macro dates from the repo file, plus stored earnings. The scoreboard does not call Yahoo."""
    data = load_macro()
    events: list[dict[str, Any]] = []
    for day in data.get("fomc", []):
        if day <= as_of:
            events.append({"date": day, "type": "FOMC", "symbol": None})
    for day in data.get("cpi", []):
        if day <= as_of:
            events.append({"date": day, "type": "CPI", "symbol": None})
    events.extend(load_earnings_events(db, as_of, symbols))
    return events


def run_agents(trigger: str, now: datetime | None = None) -> dict[str, Any]:

    """
    Month-end pass: every agent without a success for the latest complete month
    runs once and its forecasts for that month are recorded. Safe to call daily.
    """
    now = now or utcnow()
    if not try_start_agents():
        return {"ran": False, "asOf": None, "reason": "an agent pass is already running"}
    try:
        with SessionLocal() as db:
            as_of = current_as_of(db, now)
            if as_of is None:
                return {"ran": False, "asOf": None, "reason": "no complete month in the ^GSPC calendar"}
            as_of_date = date.fromisoformat(as_of)
            previous = [
                AgentRunState(run.agent, run.model_version, run.ok, run.started_at, run.finished_at)
                for run in db.scalars(select(AgentRun).where(AgentRun.as_of == as_of_date)).all()
            ]
            due = agents_due(AGENTS, previous, now, AGENT_IN_FLIGHT)
            if not due:
                _ensure_decisions(db, as_of_date)
                return {"ran": False, "asOf": as_of, "reason": f"every agent already ran for {as_of}"}

            runs = [AgentRun(agent=agent.name, as_of=as_of_date, trigger=trigger, model_version=agent.version) for agent in due]
            db.add_all(runs)
            db.commit()
            try:
                symbols = agent_universe(db)
                refresh_failed = _refresh_universe(db, symbols, as_of)
                record_earnings(db, symbols)
                data = load_agent_input(db, as_of, symbols)
            except Exception as err:
                db.rollback()
                for run in runs:
                    run.finished_at = utcnow()
                    run.error = f"data load failed: {str(err)[:500]}"
                db.commit()
                raise

            summary = []
            for index, result in enumerate(run_agent_set(due, data)):
                run = runs[index]
                agent = due[index]
                if not result.ok:
                    run.finished_at = utcnow()
                    run.error = (result.error or "failed")[:500]
                    db.commit()
                    summary.append({"agent": result.agent, "ok": False, "rows": 0, "error": result.error})
                    continue
                rows = [
                    {
                        "id": new_id(),
                        "runId": run.id,
                        "agent": agent.name,
                        "symbol": row.symbol,
                        "asOf": as_of_date,
                        "horizon": agent.horizon,
                        "target": agent.target,
                        "value": row.forecast,
                        "modelVersion": agent.version,
                        "createdAt": utcnow(),
                    }
                    for row in result.live or []
                ]
                table = table_of(AgentForecast)
                inserted = len(db.execute(insert(table).values(rows).on_conflict_do_nothing().returning(table.c.id)).all()) if rows else 0
                run.finished_at = utcnow()
                run.ok = True
                run.rows = len(rows)
                db.commit()
                summary.append({"agent": agent.name, "ok": True, "rows": inserted, "error": None})
            _ensure_decisions(db, as_of_date, data)
            return {"ran": True, "asOf": as_of, "refreshFailed": refresh_failed, "agents": summary}
    finally:
        finish_agents()


def _run_view(run: AgentRun) -> dict[str, Any]:
    return {
        "agent": run.agent,
        "asOf": date_key(run.as_of),
        "trigger": run.trigger,
        "modelVersion": run.model_version,
        "startedAt": iso(run.started_at),
        "finishedAt": iso(run.finished_at) if run.finished_at else None,
        "ok": run.ok,
        "error": run.error,
        "rows": run.rows,
    }


def _recorded_forecasts(db: Session, agent: str, target: str, horizon: str) -> dict[str, Any]:
    latest = db.scalar(
        select(func.max(AgentForecast.as_of)).where(
            AgentForecast.agent == agent, AgentForecast.target == target, AgentForecast.horizon == horizon
        )
    )
    if latest is None:
        return {"agent": agent, "target": target, "horizon": horizon, "asOf": None, "recordedAt": None, "liveMonths": 0, "rows": []}
    rows = db.scalars(
        select(AgentForecast)
        .where(
            AgentForecast.agent == agent,
            AgentForecast.target == target,
            AgentForecast.horizon == horizon,
            AgentForecast.as_of == latest,
        )
        .order_by(AgentForecast.value.desc())
    ).all()
    months = (
        db.scalar(
            select(func.count(func.distinct(AgentForecast.as_of))).where(
                AgentForecast.agent == agent, AgentForecast.target == target, AgentForecast.horizon == horizon
            )
        )
        or 0
    )
    return {
        "agent": agent,
        "target": target,
        "horizon": horizon,
        "asOf": date_key(latest),
        "recordedAt": iso(rows[0].created_at) if rows else None,
        "liveMonths": months,
        "rows": [{"symbol": row.symbol, "value": float(row.value)} for row in rows],
    }


def _ensure_decisions(db: Session, as_of: date, data: AgentInput | None = None) -> None:
    """Write the month's book once. A later pass leaves the rows alone."""
    existing = db.scalar(select(func.count()).select_from(AgentDecision).where(AgentDecision.as_of == as_of)) or 0
    if existing:
        return
    if data is None:
        data = load_agent_input(db, date_key(as_of), agent_universe(db))
    results = run_agent_set(DECISION_AGENTS, data)
    decision = decide_from_outputs([result.output for result in results if result.ok and result.output])
    if not decision.rows:
        return
    table = table_of(AgentDecision)
    db.execute(
        insert(table)
        .values(
            [
                {
                    "id": new_id(),
                    "asOf": as_of,
                    "symbol": row.symbol,
                    "weight": row.weight,
                    "action": row.action,
                    "reason": row.reason,
                    "rules": json.dumps(row.rules),
                    "createdAt": utcnow(),
                }
                for row in decision.rows
            ]
        )
        .on_conflict_do_nothing()
    )
    db.commit()


def _decision_view(db: Session, results: list[Any], as_of: str | None) -> dict[str, Any]:
    outputs = [result.output for result in results if result.ok and result.output]
    decision = decide_from_outputs(outputs)
    stored_on = date.fromisoformat(as_of) if as_of else None
    stored = (
        db.scalars(select(AgentDecision).where(AgentDecision.as_of == stored_on).order_by(AgentDecision.weight.desc())).all()
        if stored_on
        else []
    )
    if stored:
        rows = [
            {"symbol": row.symbol, "weight": float(row.weight), "action": row.action, "reason": row.reason, "rules": json.loads(row.rules)}
            for row in stored
        ]
        recorded = True
    else:
        rows = [
            {"symbol": row.symbol, "weight": row.weight, "action": row.action, "reason": row.reason, "rules": row.rules}
            for row in decision.rows
        ]
        recorded = False
    return {"month": decision.month, "recorded": recorded, "weights": decision.weights, "rows": rows, "notes": decision.notes}


def _headline_progress(db: Session) -> dict[str, Any]:
    total = db.scalar(select(func.count()).select_from(NewsHeadline)) or 0
    symbols = db.scalar(select(func.count(func.distinct(NewsHeadline.symbol)))) or 0
    since, latest = db.execute(select(func.min(NewsHeadline.recorded_at), func.max(NewsHeadline.published))).one()
    return {"total": total, "symbols": symbols, "since": iso(since) if since else None, "latest": iso(latest) if latest else None}


def get_agents_overview(db: Session, now: datetime | None = None) -> dict[str, Any]:
    """Scoreboard recomputed from stored prices (no Yahoo calls), plus the recorded live forecasts."""
    now = now or utcnow()
    as_of = current_as_of(db, now)
    symbols = agent_universe(db)
    data = load_agent_input(db, as_of, symbols) if as_of else None
    results = run_agent_set(AGENTS, data) if data else []
    latest_runs = [
        db.scalars(
            select(AgentRun)
            .where(AgentRun.agent == agent.name, AgentRun.model_version == agent.version)
            .order_by(AgentRun.started_at.desc())
            .limit(1)
        ).first()
        for agent in AGENTS
    ]

    notes = [
        f"Universe: the {len(BASKET['symbols'])}-name basket dated {BASKET['asOf']} plus every name in any portfolio, plus SPY for the index view. Return-rank agents use the US names only; Bursa names have no factor data and too few peers for a cross-section.",
        f"Everything here is out of sample: each month is forecast by a model fitted only on months whose outcome was known beforehand, starting after {MIN_TRAIN_MONTHS} months of training.",
        "With about 70 test months, a mean IC needs to be roughly 0.035 or more to clear t = 2. Monthly t-stats use Newey–West (3 lags); intervals are the 5th–95th percentile of 2,000 stationary bootstrap resamples in 3-month blocks.",
        "The scoreboard is a backtest recomputed from stored prices. Recorded forecasts are the live record, written at each month end before the outcome is known, and are never edited.",
        "G2 adds Quant, Event and Risk drawdown probability. FOMC and CPI dates come from macroEvents.json. Earnings dates are the stored Yahoo filing dates (filled by the daily sync); the scoreboard does not call Yahoo. The same models also report a five-session horizon; decisions stay on the one-month horizon. HAR vol stays one month.",
        "The decision engine combines the one-month Technical, Quant and Event ranks. Sentiment has no weight until 12 scored months exist. Five-session forecasts are not used.",
    ]
    if data:
        present = {series.symbol for series in data.series}
        empty = [symbol for symbol in symbols if symbol not in present]
        if empty:
            notes.append(f"No stored prices for {', '.join(empty)}; the next month-end pass fetches them.")

    agents = []
    for agent in AGENTS:
        result = next((row for row in results if row.version == agent.version), None)
        agents.append(
            {
                "name": agent.name,
                **AGENT_INFO[agent.name],
                "version": agent.version,
                "target": agent.target,
                "horizon": agent.horizon,
                "error": result.error if result and not result.ok else None,
                "notes": result.output.notes if result and result.ok and result.output else [],
            }
        )
    return {
        "asOf": as_of,
        "universe": {
            "symbols": len(symbols),
            "us": len([s for s in symbols if not s.endswith(".KL")]),
            "bursa": len([s for s in symbols if s.endswith(".KL")]),
            "basket": len(BASKET["symbols"]),
            "basketAsOf": BASKET["asOf"],
        },
        "agents": agents,
        "runs": [_run_view(run) for run in latest_runs if run is not None],
        "scoreboard": [score_agent(result.output) for result in results if result.ok and result.output],
        "recorded": [_recorded_forecasts(db, agent.name, agent.target, agent.horizon) for agent in AGENTS],
        "headlines": _headline_progress(db),
        "decisions": _decision_view(db, results, as_of),
        "notes": notes,
    }
