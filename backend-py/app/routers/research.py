from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, ValidationError, field_validator

from app.deps import Db, UserId
from app.errors import AppError
from app.jsonenc import NodeRoute
from app.schemas import _number
from app.services.agents import get_agents_overview
from app.services.momentum import get_momentum_study

router = APIRouter(route_class=NodeRoute)


class MomentumQuery(BaseModel):
    portfolioId: str | None = None
    universe: Literal["holdings", "basket"] = "basket"
    commissionBps: float = Field(default=5, ge=0, le=100)
    slippageBps: float = Field(default=5, ge=0, le=100)
    short: Literal["0", "1"] = "0"

    @field_validator("portfolioId", mode="before")
    @classmethod
    def _trim(cls, value: Any) -> Any:
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError("String must contain at least 1 character(s)")
        return value

    @field_validator("commissionBps", "slippageBps", mode="before")
    @classmethod
    def _coerce(cls, value: Any) -> float:
        return _number(value)


@router.get("/momentum")
def momentum(request: Request, db: Db, user_id: UserId) -> Any:
    try:
        query = MomentumQuery.model_validate(dict(request.query_params))
    except ValidationError as err:
        raise AppError(400, "VALIDATION_ERROR", "universe is holdings or basket; cost bps must be between 0 and 100.") from err
    return get_momentum_study(db, user_id, query.portfolioId, query.universe, query.commissionBps, query.slippageBps, query.short == "1")


@router.get("/agents")
def agents(db: Db, user_id: UserId) -> Any:
    return get_agents_overview(db)
