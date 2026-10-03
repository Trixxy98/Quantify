"""JSON exactly as Express + Prisma emit it, so the frontend cannot tell the backends apart."""

import functools
import json
import math
from collections.abc import Callable
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from fastapi import Response
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from app.timeutil import iso


def decimal_string(value: Decimal) -> str:
    """Prisma's Decimal (decimal.js) drops trailing zeros and never uses exponents for these magnitudes."""
    text = format(value.normalize(), "f")
    return "0" if text in ("-0", "") else text


def to_jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        # JSON.stringify turns NaN and Infinity into null.
        return value if math.isfinite(value) else None
    if isinstance(value, datetime):
        return iso(value)
    if isinstance(value, date):
        return f"{value.isoformat()}T00:00:00.000Z"
    if isinstance(value, Decimal):
        return decimal_string(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items() if item is not _OMIT}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    if hasattr(value, "__float__"):
        return to_jsonable(float(value))
    raise TypeError(f"not JSON serialisable: {type(value).__name__}")


class _Omit:
    """Stands in for `undefined`: the key is left out, as JSON.stringify does."""


_OMIT = _Omit()
OMIT: Any = _OMIT


class NodeJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return json.dumps(to_jsonable(content), ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


class NodeRoute(APIRoute):
    """
    Hands endpoint results straight to NodeJSONResponse. FastAPI would otherwise
    run jsonable_encoder first, which drops the Z from dates and keeps Decimal
    trailing zeros, so the JSON would no longer match the Node API.
    """

    def __init__(self, path: str, endpoint: Callable[..., Any], **kwargs: Any) -> None:
        status_code = kwargs.get("status_code") or 200

        @functools.wraps(endpoint)
        def wrapped(*args: Any, **inner: Any) -> Any:
            result = endpoint(*args, **inner)
            if isinstance(result, Response):
                return result
            return NodeJSONResponse(result, status_code=status_code)

        super().__init__(path, wrapped, **kwargs)
