"""
Read-only check that this backend's Yahoo client would store the same bars,
splits and dividends the Node API stored. Nothing is written.

Usage: uv run python scripts/compare_bars.py [--days 400]
"""

import argparse
import json
import sys
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import BenchmarkPrice, Currency, DailyPrice, Dividend, ExchangeRate, StockSplit  # noqa: E402
from app.services import market, yahoo  # noqa: E402
from app.services.fx import fx_bar_date, is_weekend_date  # noqa: E402
from app.timeutil import to_utc_date, utcnow  # noqa: E402

BASKET = json.loads((Path(__file__).resolve().parents[2] / "backend/src/data/momentumBasket.json").read_text())["symbols"]
SIX = Decimal("0.000001")


def six(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(repr(value)).quantize(SIX, rounding=ROUND_HALF_UP)


def compare_symbol(db, symbol: str, since: date, today: date) -> list[str]:  # type: ignore[no-untyped-def]
    chart = yahoo.chart(symbol, market.HISTORY_START)
    stored = {row.date: row for row in db.scalars(select(DailyPrice).where(DailyPrice.symbol == symbol, DailyPrice.date >= since)).all()}
    fetched = {to_utc_date(bar.date): bar for bar in chart.quotes if to_utc_date(bar.date) >= since}
    problems: list[str] = []
    # The newest bar can still be moving; compare settled sessions only.
    settled = {day for day in set(stored) & set(fetched) if day < today - timedelta(days=1)}
    for day in sorted(set(stored) - set(fetched)):
        if day < today - timedelta(days=1):
            problems.append(f"{symbol} {day}: stored, not returned")
    for day in sorted(set(fetched) - set(stored)):
        if day < today - timedelta(days=3):
            problems.append(f"{symbol} {day}: returned, not stored")
    for day in sorted(settled):
        row, bar = stored[day], fetched[day]
        for name in ("open", "high", "low", "close"):
            want = getattr(row, name)
            got = six(getattr(bar, name) if getattr(bar, name) is not None else bar.close)
            if got != want:
                problems.append(f"{symbol} {day} {name}: stored {want} fetched {got}")
        if round(bar.volume or 0) != row.volume:
            problems.append(f"{symbol} {day} volume: stored {row.volume} fetched {round(bar.volume or 0)}")
    splits = {(to_utc_date(s["date"]), round(s["numerator"]), round(s["denominator"])) for s in chart.splits if s.get("numerator") and s.get("denominator")}
    stored_splits = {(s.date, s.numerator, s.denominator) for s in db.scalars(select(StockSplit).where(StockSplit.symbol == symbol)).all()}
    if splits != stored_splits:
        problems.append(f"{symbol} splits differ: stored {sorted(stored_splits - splits)} fetched {sorted(splits - stored_splits)}")
    dividends = {(to_utc_date(d["date"]), six(d["amount"])) for d in chart.dividends if d.get("amount") and d["amount"] > 0}
    stored_divs = {(d.ex_date, d.amount) for d in db.scalars(select(Dividend).where(Dividend.symbol == symbol)).all()}
    if dividends != stored_divs:
        problems.append(f"{symbol} dividends differ: stored-only {sorted(stored_divs - dividends)[:3]} fetched-only {sorted(dividends - stored_divs)[:3]}")
    return problems


def compare_benchmark(db, symbol: str, since: date, today: date) -> list[str]:  # type: ignore[no-untyped-def]
    stored = {row.date: row.close for row in db.scalars(select(BenchmarkPrice).where(BenchmarkPrice.symbol == symbol, BenchmarkPrice.date >= since)).all()}
    fetched = {to_utc_date(bar.date): six(bar.close) for bar in yahoo.chart(symbol, market.HISTORY_START).quotes if to_utc_date(bar.date) >= since}
    return [
        f"{symbol} {day}: stored {stored.get(day)} fetched {fetched.get(day)}"
        for day in sorted(set(stored) | set(fetched))
        if day < today - timedelta(days=1) and stored.get(day) != fetched.get(day)
    ]


def compare_fx(db, since: date, today: date) -> list[str]:  # type: ignore[no-untyped-def]
    stored = {
        row.date: row.rate
        for row in db.scalars(select(ExchangeRate).where(ExchangeRate.from_ == Currency.USD, ExchangeRate.to == Currency.MYR, ExchangeRate.date >= since)).all()
    }
    fetched: dict[date, Decimal | None] = {}
    for bar in yahoo.chart(market.USD_MYR_SYMBOL, market.HISTORY_START).quotes:
        day = fx_bar_date(bar.date).date()
        if day >= since and not is_weekend_date(day):
            fetched[day] = None if bar.close is None else Decimal(repr(bar.close)).quantize(Decimal("0.00000001"))
    return [
        f"MYR=X {day}: stored {stored.get(day)} fetched {fetched.get(day)}"
        for day in sorted(set(stored) | set(fetched))
        if day < today - timedelta(days=2) and stored.get(day) != fetched.get(day)
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=400)
    args = parser.parse_args()
    today = utcnow().date()
    since = today - timedelta(days=args.days)
    problems: list[str] = []
    with SessionLocal() as db:
        symbols = sorted(set(market.get_tracked_symbols(db)) | set(BASKET))
        for symbol in symbols:
            found = compare_symbol(db, symbol, since, today)
            print(f"{symbol}: {'ok' if not found else f'{len(found)} differences'}")
            problems += found
        for symbol in market.BENCHMARK_SYMBOLS:
            found = compare_benchmark(db, symbol, since, today)
            print(f"{symbol}: {'ok' if not found else f'{len(found)} differences'}")
            problems += found
        found = compare_fx(db, since, today)
        print(f"MYR=X: {'ok' if not found else f'{len(found)} differences'}")
        problems += found
    for problem in problems[:60]:
        print(" ", problem)
    print(f"{len(problems)} differences across {len(symbols) + len(market.BENCHMARK_SYMBOLS) + 1} series")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
