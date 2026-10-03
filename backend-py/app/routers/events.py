import re
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.deps import Db, UserId
from app.errors import AppError
from app.jsonenc import NodeRoute
from app.schemas import _number
from app.services.event_study import run_event_study
from app.services.variance_premium import get_variance_premium

router = APIRouter(route_class=NodeRoute)
MAX_SYMBOLS = 8
TICKER = re.compile(r"^[A-Z0-9][A-Z0-9.-]{0,11}$")


def _int(value: Any) -> int:
    number = _number(value)
    if number != number or number != int(number):
        raise ValueError("Expected integer")
    return int(number)


class StudyQuery(BaseModel):
    symbols: str = Field(min_length=1, max_length=120)
    type: Literal["FOMC", "CPI", "EARNINGS"]
    pre: int = Field(default=5, ge=1, le=20)
    post: int = Field(default=10, ge=1, le=30)
    years: int = Field(default=5, ge=2, le=6)
    hold: int = Field(default=3, ge=1, le=20)

    @field_validator("symbols", mode="before")
    @classmethod
    def _trim(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("pre", "post", "years", "hold", mode="before")
    @classmethod
    def _whole(cls, value: Any) -> int:
        return _int(value)


class PremiumQuery(BaseModel):
    symbol: str = Field(min_length=1, max_length=12)
    type: Literal["FOMC", "CPI", "EARNINGS"]
    years: int = Field(default=5, ge=2, le=6)

    @field_validator("symbol", mode="before")
    @classmethod
    def _trim(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("years", mode="before")
    @classmethod
    def _whole(cls, value: Any) -> int:
        return _int(value)


@router.get("/study")
def study(request: Request, user_id: UserId) -> Any:
    try:
        query = StudyQuery.model_validate(dict(request.query_params))
    except ValidationError as err:
        raise AppError(400, "VALIDATION_ERROR", "symbols and type (FOMC, CPI, EARNINGS) are required; pre/post/years/hold must be in range") from err
    symbols = [symbol.strip().upper() for symbol in query.symbols.split(",") if symbol.strip()]
    if not 1 <= len(symbols) <= MAX_SYMBOLS:
        raise AppError(400, "VALIDATION_ERROR", f"Pass between 1 and {MAX_SYMBOLS} symbols.")
    if any(not TICKER.match(symbol) for symbol in symbols):
        raise AppError(400, "VALIDATION_ERROR", "One of the symbols is not a valid ticker.")
    return run_event_study(symbols, query.type, query.pre, query.post, query.years, query.hold)


@router.get("/premium")
def premium(request: Request, db: Db, user_id: UserId) -> Any:
    try:
        query = PremiumQuery.model_validate(dict(request.query_params))
    except ValidationError as err:
        raise AppError(400, "VALIDATION_ERROR", "symbol and type (FOMC, CPI, EARNINGS) are required; years must be between 2 and 6") from err
    symbol = query.symbol.upper()
    if not TICKER.match(symbol):
        raise AppError(400, "VALIDATION_ERROR", "That ticker is not valid.")
    return get_variance_premium(db, symbol, query.type, query.years)
