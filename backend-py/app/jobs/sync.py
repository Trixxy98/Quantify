import logging
import math
from datetime import datetime, timedelta
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.errors import AppError
from app.jobs.market_session import latest_us_session_close
from app.jobs.state import finish_sync, try_start_sync
from app.models import DailyPrice, SyncRun
from app.timeutil import iso, utcnow

log = logging.getLogger("quantify")

MIN_DAYS_BACK = 7
MAX_DAYS_BACK = 400
# A run unfinished after this long is assumed dead (process killed mid-sync).
IN_FLIGHT = timedelta(hours=1)

SyncTrigger = Literal["cron", "manual", "startup", "script"]


def run_full_sync(days_back: int = MAX_DAYS_BACK, trigger: SyncTrigger = "manual") -> dict[str, Any]:
    from app.services.agents import agent_universe, run_agents
    from app.services.earnings import record_earnings
    from app.services.factors import refresh_factors_if_stale
    from app.services.headlines import record_headlines
    from app.services.implied_snapshot import capture_implied_snapshots
    from app.services.market import get_tracked_symbols, sync_market_data
    from app.services.snapshot import rebuild_all_snapshots

    if not try_start_sync():
        raise AppError(409, "SYNC_IN_PROGRESS", "Sync is already running, try again later")
    db = SessionLocal()
    run = SyncRun(trigger=trigger)
    try:
        db.add(run)
        db.commit()
        market = sync_market_data(db, days_back)
        portfolios = rebuild_all_snapshots(db)
        # Yahoo has no IV history, so today's front-month ATM straddle is the only
        # chance to record it. Upserts by session, so a manual sync during US
        # hours is overwritten by the closing marks next morning.
        implied = capture_implied_snapshots(db, get_tracked_symbols(db))
        # Same reason as the IV rows: Yahoo serves today's headlines only.
        headlines = record_headlines(db, agent_universe(db))
        earnings = record_earnings(db, agent_universe(db))
        factors = refresh_factors_if_stale(db)
        run.finished_at = utcnow()
        run.ok = True
        db.commit()
        # Month-end step. Does nothing until a new month completes; its failure is logged, not the sync's.
        try:
            agents: dict[str, Any] = run_agents(trigger)
        except Exception as err:
            log.exception("[agents] month-end pass failed")
            agents = {"ran": False, "asOf": None, "reason": str(err)}
        return {
            **market,
            "portfolios": portfolios,
            "impliedSnapshots": implied["recorded"],
            "headlines": headlines["recorded"],
            "earnings": earnings["recorded"],
            "factorsThrough": factors["through"],
            "agents": agents,
        }
    except Exception as err:
        db.rollback()
        try:
            run.finished_at = utcnow()
            run.error = str(err)[:500]
            db.add(run)
            db.commit()
        except Exception:
            db.rollback()
        raise
    finally:
        db.close()
        finish_sync()


def _catch_up_days_back(db: Session, last_ok: datetime | None) -> int:
    since = last_ok
    if since is None:
        latest = db.scalar(select(func.max(DailyPrice.date)))
        since = datetime(latest.year, latest.month, latest.day) if latest else None
    if since is None:
        return MAX_DAYS_BACK
    days = math.ceil((utcnow() - since).total_seconds() / 86400) + MIN_DAYS_BACK
    return min(MAX_DAYS_BACK, max(MIN_DAYS_BACK, days))


def catch_up_if_stale(trigger: SyncTrigger, now: datetime | None = None) -> dict[str, Any]:
    """
    Runs a sync when no successful one has finished since the last US close.
    Option chains cannot be fetched after the fact, so every session this
    skips is a permanent gap in the implied-vol history.
    """
    from app.jobs.state import is_full_sync_running

    now = now or utcnow()
    if is_full_sync_running():
        return {"ran": False, "reason": "a sync is already running"}
    with SessionLocal() as db:
        # The flag above is per process; the API and the script share only the table.
        in_flight = db.scalars(
            select(SyncRun).where(SyncRun.finished_at.is_(None), SyncRun.started_at >= now - IN_FLIGHT).limit(1)
        ).first()
        if in_flight:
            return {"ran": False, "reason": f"another process started a sync at {iso(in_flight.started_at)}"}
        last_ok = db.scalars(select(SyncRun).where(SyncRun.ok.is_(True)).order_by(SyncRun.finished_at.desc().nulls_last()).limit(1)).first()
        close = latest_us_session_close(now)
        if last_ok and last_ok.finished_at and last_ok.finished_at >= close:
            return {"ran": False, "reason": f"last sync finished {iso(last_ok.finished_at)}, after the {iso(close)} close"}
        days_back = _catch_up_days_back(db, last_ok.finished_at if last_ok else None)
    result = run_full_sync(days_back, trigger)
    return {"ran": True, "daysBack": days_back, "result": result}
