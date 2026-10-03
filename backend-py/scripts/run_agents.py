"""
Manual month-end pass of the forecasting agents. Records forecasts for the
latest complete month; skips agents that already succeeded for it.

Usage: uv run python scripts/run_agents.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.agents import run_agents  # noqa: E402

if __name__ == "__main__":
    outcome = run_agents("script")
    print(outcome if outcome["ran"] else f"Skipped: {outcome['reason']}")
