"""
Daily sync without the API running, for launchd or cron.

Skips when a sync has already finished after the last US close, so it is safe
to schedule alongside the API's own 6:30am job. `--force` always runs.

Usage: uv run python scripts/sync_daily.py [--force]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.jobs.sync import MIN_DAYS_BACK, catch_up_if_stale, run_full_sync  # noqa: E402


def main() -> int:
    if "--force" in sys.argv:
        print(run_full_sync(MIN_DAYS_BACK, "script"))
        return 0
    outcome = catch_up_if_stale("script")
    print(outcome["result"] if outcome["ran"] else f"Skipped: {outcome['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
