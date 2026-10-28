import csv
from io import StringIO

from app.errors import AppError

_ALIASES = {
    "symbol": "symbol",
    "ticker": "symbol",
    "type": "type",
    "side": "type",
    "action": "type",
    "quantity": "quantity",
    "qty": "quantity",
    "shares": "quantity",
    "price": "price",
    "currency": "currency",
    "ccy": "currency",
    "fee": "fee",
    "commission": "fee",
    "date": "date",
    "trade date": "date",
}
_REQUIRED = ("symbol", "type", "quantity", "price", "date")


def parse_trade_csv(text: str) -> list[tuple[int, dict[str, str | float]]]:
    reader = csv.DictReader(StringIO(text.lstrip("\ufeff")))
    if not reader.fieldnames:
        raise AppError(400, "VALIDATION_ERROR", "CSV needs a header row")
    mapping: dict[str, str] = {}
    for name in reader.fieldnames:
        canon = _ALIASES.get(name.strip().lower())
        if canon:
            mapping[name] = canon
    missing = [name for name in _REQUIRED if name not in mapping.values()]
    if missing:
        raise AppError(400, "VALIDATION_ERROR", "CSV header is missing " + ", ".join(missing))

    rows: list[tuple[int, dict[str, str | float]]] = []
    for line, raw in enumerate(reader, start=2):
        if all(not (value or "").strip() for value in raw.values()):
            continue
        item = {canon: (raw[source] or "").strip() for source, canon in mapping.items()}
        symbol = str(item["symbol"]).upper()
        item["symbol"] = symbol
        item["type"] = str(item["type"]).upper()
        if not item.get("currency"):
            item["currency"] = "MYR" if symbol.endswith(".KL") else "USD"
        if not item.get("fee"):
            item["fee"] = 0
        rows.append((line, item))
    if not rows:
        raise AppError(400, "VALIDATION_ERROR", "CSV has no trades")
    return rows