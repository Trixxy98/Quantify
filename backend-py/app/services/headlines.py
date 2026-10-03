import logging

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import NewsHeadline, new_id, table_of
from app.services import yahoo
from app.timeutil import utcnow

log = logging.getLogger("quantify")
# Yahoo returns the latest few; recording daily keeps up with all but the busiest names.
NEWS_COUNT = 20
ALWAYS_RECORD = ["SPY"]


def record_headlines(db: Session, symbols: list[str]) -> dict[str, int]:
    """Records today's headlines for each US symbol. Yahoo has no headline history; failures are per symbol."""
    us = [symbol for symbol in dict.fromkeys([*ALWAYS_RECORD, *symbols]) if "." not in symbol and not symbol.startswith("^")]
    recorded = 0
    for symbol in us:
        try:
            result = yahoo.search(symbol, 0, NEWS_COUNT)
            rows = []
            for item in result.get("news") or []:
                related = item.get("relatedTickers")
                # A search hit that does not tag the symbol is about something else.
                if not item.get("uuid") or not item.get("title") or (related and symbol not in related):
                    continue
                published = item.get("providerPublishTime")
                if not isinstance(published, (int, float)):
                    continue
                rows.append(
                    {
                        "id": new_id(),
                        "symbol": symbol,
                        "sourceId": item["uuid"],
                        "published": yahoo.from_epoch(published),
                        "title": item["title"][:500],
                        "publisher": item.get("publisher") or "",
                        "link": item.get("link"),
                        "recordedAt": utcnow(),
                    }
                )
            if not rows:
                continue
            inserted = db.execute(insert(table_of(NewsHeadline)).values(rows).on_conflict_do_nothing().returning(table_of(NewsHeadline).c.id)).all()
            db.commit()
            recorded += len(inserted)
        except Exception:
            db.rollback()
            log.exception("[headlines] record failed %s", symbol)
    return {"attempted": len(us), "recorded": recorded}
