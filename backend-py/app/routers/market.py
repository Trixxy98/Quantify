import logging
import re
from datetime import date
from typing import Any

from fastapi import APIRouter, Request

from app.deps import Db, UserId
from app.errors import AppError
from app.jsonenc import NodeRoute
from app.services import market

router = APIRouter(route_class=NodeRoute)
log = logging.getLogger("quantify")
MAX_TICKER_SYMBOLS = 25
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _text(request: Request, name: str, low: int, high: int) -> str | None:
    """A trimmed query string within zod-style length bounds, or None."""
    value = request.query_params.get(name)
    if value is None:
        return None
    value = value.strip()
    return value if low <= len(value) <= high else None


@router.get("/search")
def search(request: Request, user_id: UserId) -> Any:
    q = _text(request, "q", 1, 80)
    if q is None:
        raise AppError(400, "VALIDATION_ERROR", "Query q is required")
    try:
        return market.search_symbols(q)
    except Exception as err:
        log.exception("[search] Yahoo search failed")
        raise AppError(502, "SEARCH_FAILED", "Symbol search is unavailable. Type the ticker instead.") from err


@router.get("/close")
def close(request: Request, db: Db, user_id: UserId) -> Any:
    symbol = _text(request, "symbol", 1, 20)
    day = request.query_params.get("date")
    if symbol is None or day is None or not DATE_RE.match(day):
        raise AppError(400, "VALIDATION_ERROR", "symbol and date (YYYY-MM-DD) are required")
    try:
        return market.get_close_on_or_before(db, symbol, date.fromisoformat(day))
    except Exception as err:
        log.exception("[close] Failed to load market close")
        raise AppError(502, "PRICE_UNAVAILABLE", "Could not load the market price. Enter it manually.") from err


@router.get("/quotes")
def quotes(request: Request, user_id: UserId) -> Any:
    raw = _text(request, "symbols", 1, 400)
    if raw is None:
        raise AppError(400, "VALIDATION_ERROR", "symbols is required")
    symbols = [symbol.strip().upper() for symbol in raw.split(",") if symbol.strip()]
    if not 1 <= len(symbols) <= MAX_TICKER_SYMBOLS:
        raise AppError(400, "VALIDATION_ERROR", f"Pass between 1 and {MAX_TICKER_SYMBOLS} symbols.")
    # Indices (^KLSE) and FX pairs (MYR=X) are valid here, unlike the holdings endpoints.
    if any(not market.TICKER.match(symbol) for symbol in symbols):
        raise AppError(400, "VALIDATION_ERROR", "One of the symbols is not a valid ticker.")
    try:
        return market.get_quotes(symbols)
    except Exception as err:
        log.exception("[quotes] Yahoo quote failed")
        raise AppError(502, "QUOTES_UNAVAILABLE", "Live quotes are unavailable right now.") from err


@router.get("/iv-surface")
def iv_surface(request: Request, user_id: UserId) -> Any:
    from app.services.iv_surface import build_iv_surface

    symbol = _text(request, "symbol", 1, 20)
    if symbol is None:
        raise AppError(400, "VALIDATION_ERROR", "symbol is required")
    return build_iv_surface(symbol)


@router.get("/health")
def health(db: Db, user_id: UserId) -> Any:
    from app.services.data_health import get_data_health

    return get_data_health(db, user_id)
