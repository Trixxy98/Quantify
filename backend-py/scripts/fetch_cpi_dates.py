"""
Fills the `cpi` array in app/data/macroEvents.json with US CPI release dates.

BLS blocks automated fetches of its own release schedule, so this reads the
FRED release calendar instead (FRED mirrors the BLS release dates).

Usage: FRED_API_KEY=... uv run python scripts/fetch_cpi_dates.py
Free key: https://fredaccount.stlouisfed.org/apikeys
"""

import json
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.services.events import MACRO_FILE  # noqa: E402
from app.timeutil import date_key, utcnow  # noqa: E402

API = "https://api.stlouisfed.org/fred"
RELEASE_NAME = "Consumer Price Index"
REALTIME_START = "2015-01-01"


def get_json(path: str, params: dict[str, str]) -> dict:
    if not settings.FRED_API_KEY:
        raise SystemExit("FRED_API_KEY is missing. Get a free key at https://fredaccount.stlouisfed.org/apikeys")
    response = httpx.get(f"{API}{path}", params={**params, "api_key": settings.FRED_API_KEY, "file_type": "json"}, timeout=60)
    if response.status_code != 200:
        raise SystemExit(f"FRED {path} failed: {response.status_code} {response.text}")
    return response.json()


def main() -> None:
    releases = get_json("/releases", {"limit": "1000"}).get("releases", [])
    match = next((release for release in releases if release.get("name") == RELEASE_NAME), None)
    if match is None:
        raise SystemExit(f'Could not find a FRED release named "{RELEASE_NAME}"')
    rows = get_json(
        "/release/dates",
        {
            "release_id": str(match["id"]),
            "realtime_start": REALTIME_START,
            "limit": "10000",
            "sort_order": "asc",
            "include_release_dates_with_no_data": "false",
        },
    ).get("release_dates", [])
    dates = sorted({row["date"] for row in rows})
    if not dates:
        raise SystemExit("FRED returned no release dates")
    data = json.loads(MACRO_FILE.read_text())
    data["cpi"] = dates
    data["_cpiSource"] = (
        f'FRED release {match["id"]} ("{RELEASE_NAME}") release dates from {REALTIME_START}, fetched {date_key(utcnow())}. '
        "FRED mirrors the BLS CPI release schedule."
    )
    MACRO_FILE.write_text(json.dumps(data, indent=2) + "\n")
    print(f"Wrote {len(dates)} CPI release dates ({dates[0]} to {dates[-1]})")


if __name__ == "__main__":
    main()
