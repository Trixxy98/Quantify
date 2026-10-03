"""
Downloads the Ken French daily five-factor and momentum files and replaces the stored table.

Usage: uv run python scripts/refresh_factors.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal  # noqa: E402
from app.services.factors import refresh_factors  # noqa: E402

if __name__ == "__main__":
    with SessionLocal() as db:
        print(refresh_factors(db))
