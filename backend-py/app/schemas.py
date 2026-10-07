"""Request schemas, with the same messages the Node API's zod validators returned."""

import math
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, field_validator, model_validator

from app.timeutil import from_ms

CurrencyName = Literal["MYR", "USD"]
RangeName = Literal["1M", "3M", "6M", "1Y", "YTD", "ALL"]


def coerce_date(value: Any) -> datetime:
    """zod `z.coerce.date()`: `new Date(value)`, stored as naive UTC."""
    if isinstance(value, datetime):
        return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value
    if isinstance(value, bool) or value is None:
        raise ValueError("Invalid date")
    if isinstance(value, (int, float)):
        if not math.isfinite(value):
            raise ValueError("Invalid date")
        return from_ms(value)
    if isinstance(value, str):
        text = value.strip()
        try:
            if len(text) == 10:
                # Date-only strings are UTC midnight in JavaScript.
                return datetime.fromisoformat(text)
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as err:
            raise ValueError("Invalid date") from err
        if parsed.tzinfo is None:
            # A date-time without an offset is local time in JavaScript.
            parsed = parsed.astimezone()
        return parsed.astimezone(UTC).replace(tzinfo=None)
    raise ValueError("Invalid date")


def _number(value: Any) -> float:
    """zod `z.coerce.number()`: `Number(value)`."""
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if text == "":
            return 0.0
        try:
            return float(text)
        except ValueError:
            return math.nan
    return math.nan


class CreatePortfolioBody(BaseModel):
    name: str
    baseCurrency: CurrencyName = "MYR"

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        if len(value) < 1:
            raise ValueError("Name is required")
        return value


class UpdatePortfolioBody(BaseModel):
    name: str | None = None
    baseCurrency: CurrencyName | None = None

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is not None and len(value) < 1:
            raise ValueError("String must contain at least 1 character(s)")
        return value

    @model_validator(mode="after")
    def _at_least_one(self) -> "UpdatePortfolioBody":
        if not self.model_fields_set:
            raise ValueError("At least one field is required")
        return self


class TransactionBody(BaseModel):
    symbol: str
    type: Literal["BUY", "SELL"]
    quantity: float
    price: float
    currency: CurrencyName
    fee: float = 0
    date: datetime

    @field_validator("symbol")
    @classmethod
    def _symbol(cls, value: str) -> str:
        if len(value) < 1:
            raise ValueError("Symbol is required")
        return value.upper()

    @field_validator("quantity", mode="before")
    @classmethod
    def _quantity(cls, value: Any) -> float:
        number = _number(value)
        if not number > 0:
            raise ValueError("Quantity must be greater than 0")
        return number

    @field_validator("price", mode="before")
    @classmethod
    def _price(cls, value: Any) -> float:
        number = _number(value)
        if not number > 0:
            raise ValueError("Price must be greater than 0")
        return number

    @field_validator("fee", mode="before")
    @classmethod
    def _fee(cls, value: Any) -> float:
        number = _number(value)
        if not number >= 0:
            raise ValueError("Number must be greater than or equal to 0")
        return number

    @field_validator("date", mode="before")
    @classmethod
    def _date(cls, value: Any) -> datetime:
        return coerce_date(value)


class RangeQuery(BaseModel):
    range: RangeName = "1Y"
    window: Literal[20, 60, 120] = 60

    @field_validator("window", mode="before")
    @classmethod
    def _window(cls, value: Any) -> int:
        number = _number(value)
        if number not in (20, 60, 120):
            raise ValueError("Invalid input")
        return int(number)


class TransactionsQuery(BaseModel):
    symbol: str | None = None
    page: int = 1
    limit: int = 20

    @field_validator("page", "limit", mode="before")
    @classmethod
    def _int(cls, value: Any) -> int:
        number = _number(value)
        if not math.isfinite(number) or number != int(number):
            raise ValueError("Expected integer, received float")
        return int(number)

    @model_validator(mode="after")
    def _bounds(self) -> "TransactionsQuery":
        if self.page < 1:
            raise ValueError("Number must be greater than or equal to 1")
        if not 1 <= self.limit <= 100:
            raise ValueError("Number must be between 1 and 100")
        return self
