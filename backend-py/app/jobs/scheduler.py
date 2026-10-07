import logging
import threading

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.jobs.sync import catch_up_if_stale

log = logging.getLogger("quantify")

# A Mac asleep at 6:30 fires the job on wake; APScheduler's default grace of 1s would drop it.
MISFIRE_GRACE_SECONDS = 12 * 3600


def _daily() -> None:
    # Through the staleness check, so a late run after the launchd script or a manual sync does not repeat it.
    try:
        outcome = catch_up_if_stale("cron")
        if outcome["ran"]:
            log.info("[sync] Daily sync completed successfully %s", outcome["result"])
        else:
            log.info("[sync] Daily sync skipped: %s", outcome["reason"])
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
    scheduler.add_job(
        _daily,
        CronTrigger(minute=30, hour=6, day_of_week="tue-sat", timezone="Asia/Kuala_Lumpur"),
        id="daily-sync",
        misfire_grace_time=MISFIRE_GRACE_SECONDS,
        coalesce=True,
    )
    scheduler.start()
    threading.Thread(target=_startup_catch_up, name="startup-catch-up", daemon=True).start()
    return scheduler
