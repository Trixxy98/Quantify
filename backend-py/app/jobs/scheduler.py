import logging
import threading

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.jobs.sync import MIN_DAYS_BACK, catch_up_if_stale, run_full_sync

log = logging.getLogger("quantify")


def _daily() -> None:
    try:
        log.info("[sync] Daily sync completed successfully %s", run_full_sync(MIN_DAYS_BACK, "cron"))
    except Exception:
        log.exception("[sync] Daily sync failed")


def _startup_catch_up() -> None:
    try:
        outcome = catch_up_if_stale("startup")
        if outcome["ran"]:
            log.info("[sync] Caught up on startup (%s days back) %s", outcome["daysBack"], outcome["result"])
        else:
            log.info("[sync] No catch-up needed: %s", outcome["reason"])
    except Exception:
        log.exception("[sync] Startup catch-up failed")


def start_scheduler() -> BackgroundScheduler:
    """6:30am MYT, Tue–Sat, after the US close; plus a catch-up when the API starts."""
    scheduler = BackgroundScheduler(timezone="Asia/Kuala_Lumpur")
    scheduler.add_job(_daily, CronTrigger(minute=30, hour=6, day_of_week="tue-sat", timezone="Asia/Kuala_Lumpur"), id="daily-sync")
    scheduler.start()
    threading.Thread(target=_startup_catch_up, name="startup-catch-up", daemon=True).start()
    return scheduler
