"""Record Yahoo-derived earnings dates so the Event agent can read them without calling Yahoo."""

import logging
from datetime import date

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import EarningsDate, new_id, table_of
from app.services.events import earnings_dates
from app.timeutil import date_key, utcnow

log = logging.getLogger("quantify")


def _us_symbols(symbols: list[str]) -> list[str]:
    return [symbol for symbol in dict.fromkeys(symbols) if "." not in symbol and not symbol.startswith("^")]


def record_earnings(db: Session, symbols: list[str]) -> dict[str, int]:
    """Upsert filing-derived announcement dates for each US name. A name with no filings is skipped."""
    us = _us_symbols(symbols)
    recorded = 0
    for symbol in us:
        try:
            filed = earnings_dates(symbol)
        except AppError:
            continue
        except Exception:
            db.rollback()
            log.exception("[earnings] lookup failed %s", symbol)
            continue
        rows = [
            {"id": new_id(), "symbol": symbol, "date": date.fromisoformat(row["date"]), "recordedAt": utcnow()}
            for row in filed
        ]
        if not rows:
            continue
        inserted = db.execute(
            insert(table_of(EarningsDate)).values(rows).on_conflict_do_nothing().returning(table_of(EarningsDate).c.id)
        ).all()
        db.commit()
        recorded += len(inserted)
    return {"attempted": len(us), "recorded": recorded}


def load_earnings_events(db: Session, as_of: str, symbols: list[str]) -> list[dict[str, str]]:
    """Stored announcement dates on or before `as_of`, tagged for the Event agent."""
    us = _us_symbols(symbols)
    if not us:
        return []
    rows = db.scalars(
        select(EarningsDate).where(EarningsDate.symbol.in_(us), EarningsDate.date <= date.fromisoformat(as_of))
    ).all()
    return [{"date": date_key(row.date), "type": "EARNINGS", "symbol": row.symbol} for row in rows]
