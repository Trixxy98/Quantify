"""Model rows as Prisma returns them: every column under its database (camelCase) name."""

import math
from typing import Any

from sqlalchemy import inspect

from app.models import Currency, Exchange


def row_dict(obj: Any) -> dict[str, Any]:
    mapper = inspect(obj).mapper
    return {column.name: getattr(obj, attr.key) for attr in mapper.column_attrs for column in attr.columns}


def js_number_string(value: float) -> str:
    """`String(n)` in JavaScript: integers without ".0", exponents as "1e-7"."""
    if not math.isfinite(value):
        return "NaN" if math.isnan(value) else ("Infinity" if value > 0 else "-Infinity")
    if value == int(value) and abs(value) < 1e21:
        return str(int(value))
    text = repr(value)
    if "e" in text:
        mantissa, exponent = text.split("e")
        sign = "-" if exponent.startswith("-") else "+"
        return f"{mantissa}e{sign}{int(exponent.lstrip('+-'))}"
    return text


def locale_key(text: str) -> tuple:
    """
    Sort key matching JavaScript `localeCompare` (ICU root collation) for
    tickers: punctuation before digits before letters, letters case-blind
    first, lowercase before uppercase only to break ties.
    """

    def rank(char: str) -> tuple[int, str]:
        if char.isalpha():
            return (2, char.lower())
        if char.isdigit():
            return (1, char)
        return (0, char)

    return (tuple(rank(char) for char in text), tuple(not char.islower() for char in text))


def currency_from_symbol(symbol: str) -> Currency:
    return Currency.MYR if symbol.upper().endswith(".KL") else Currency.USD


def exchange_from_symbol(symbol: str) -> Exchange:
    return Exchange.BURSA if symbol.upper().endswith(".KL") else Exchange.US
