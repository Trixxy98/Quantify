from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.jobs.market_session import latest_session
from app.jobs.sync import IN_FLIGHT
from app.models import (
    BenchmarkPrice,
    Currency,
    DailyPrice,
    Dividend,
    ExchangeRate,
    ImpliedSnapshot,
    Portfolio,
    StockSplit,
    SyncRun,
    Transaction,
)
from app.rows import locale_key
from app.services.data_health_math import (
    assess_iv_recording,
    assess_price_series,
    status_rank,
    traded_calendar,
    weekdays_after,
    worst,
)
from app.services.market import BENCHMARK_SYMBOLS
from app.timeutil import date_key, iso, utcnow

US_CALENDAR = "^GSPC"
BURSA_CALENDAR = "^KLSE"
FX_LABEL = "USD/MYR"
IV_ALWAYS = ["SPY"]
PRICE_FIELDS = ("bars", "firstDate", "lastDate", "staleSessions", "missingSessions", "missingRecent", "weekendRows", "splitCliffs", "dividendsWithoutBar")
EMPTY_PRICES: dict[str, Any] = {
    "bars": 0,
    "firstDate": None,
    "lastDate": None,
    "staleSessions": None,
    "missingSessions": 0,
    "missingRecent": [],
    "weekendRows": 0,
    "splitCliffs": [],
    "dividendsWithoutBar": [],
}


def _market_of(symbol: str) -> str:
    return "BURSA" if symbol == BURSA_CALENDAR or symbol.upper().endswith(".KL") else "US"


def _run_view(run: SyncRun) -> dict[str, Any]:
    return {
        "trigger": run.trigger,
        "startedAt": iso(run.started_at),
        "finishedAt": iso(run.finished_at) if run.finished_at else None,
        "ok": run.ok,
        "error": run.error,
    }


def _row(symbol: str, kind: str, market: str | None, prices: dict[str, Any] | None, iv: dict[str, Any] | None, splits: int = 0, dividends: int = 0) -> dict[str, Any]:
    price_part = prices or {**EMPTY_PRICES, "status": "ok", "issues": []}
    return {
        "symbol": symbol,
        "kind": kind,
        "market": market,
        **{key: price_part[key] for key in PRICE_FIELDS},
        "splits": splits,
        "dividends": dividends,
        "iv": {key: value for key, value in iv.items() if key not in ("status", "issues")} if iv else None,
        "status": worst([price_part["status"], iv["status"] if iv else "ok"]),
        "issues": [*price_part["issues"], *(iv["issues"] if iv else [])],
    }


def _sync_health(db: Session, expected_us: str, now: datetime) -> dict[str, Any]:
    last_ok = db.scalars(select(SyncRun).where(SyncRun.ok.is_(True)).order_by(SyncRun.finished_at.desc().nulls_first()).limit(1)).first()
    runs = db.scalars(select(SyncRun).order_by(SyncRun.started_at.desc())).all()
    latest_by_trigger: list[SyncRun] = []
    seen: set[str] = set()
    for run in runs:
        if run.trigger not in seen:
            seen.add(run.trigger)
            latest_by_trigger.append(run)
    in_flight = db.scalars(
        select(SyncRun).where(SyncRun.finished_at.is_(None), SyncRun.started_at >= now - IN_FLIGHT).order_by(SyncRun.started_at.desc()).limit(1)
    ).first()

    issues: list[str] = []
    statuses: list[str] = []
    if last_ok is None or last_ok.finished_at is None:
        statuses.append("bad")
        issues.append("No successful sync recorded. Press Sync or run uv run python scripts/sync_daily.py.")
    else:
        covered = latest_session(last_ok.finished_at, "US").date
        behind = weekdays_after(covered, expected_us)
        statuses.append("ok" if behind == 0 else "warn" if behind == 1 else "bad")
        if behind > 0:
            issues.append(f"Last successful sync covered the {covered} US session, {behind} behind {expected_us}.")
    latest_run = latest_by_trigger[0] if latest_by_trigger else None
    if latest_run and latest_run.finished_at and not latest_run.ok:
        statuses.append("warn")
        issues.append(f"Latest {latest_run.trigger} sync failed: {latest_run.error or 'unknown error'}.")
    return {
        "status": worst(statuses),
        "issues": issues,
        "lastOk": _run_view(last_ok) if last_ok else None,
        "inFlightSince": iso(in_flight.started_at) if in_flight else None,
        "latestByTrigger": [_run_view(run) for run in latest_by_trigger],
    }


def get_data_health(db: Session, user_id: str, now: datetime | None = None) -> dict[str, Any]:
    """
    One row per series the user's numbers depend on: each traded symbol, the
    benchmarks, USD/MYR, and the recorded implied vol.
    """
    now = now or utcnow()
    expected = {"US": latest_session(now, "US").date, "BURSA": latest_session(now, "BURSA").date}
    symbols = sorted(
        set(db.scalars(select(Transaction.symbol).join(Portfolio, Portfolio.id == Transaction.portfolio_id).where(Portfolio.user_id == user_id)).all())
    )
    us_symbols = [symbol for symbol in symbols if _market_of(symbol) == "US"]
    iv_symbols = list(dict.fromkeys([*us_symbols, *IV_ALWAYS]))

    prices = db.execute(select(DailyPrice.symbol, DailyPrice.date, DailyPrice.close).where(DailyPrice.symbol.in_(symbols)).order_by(DailyPrice.symbol, DailyPrice.date)).all()
    benchmarks = db.execute(
        select(BenchmarkPrice.symbol, BenchmarkPrice.date, BenchmarkPrice.close).where(BenchmarkPrice.symbol.in_(BENCHMARK_SYMBOLS)).order_by(BenchmarkPrice.symbol, BenchmarkPrice.date)
    ).all()
    splits = db.scalars(select(StockSplit).where(StockSplit.symbol.in_(symbols)).order_by(StockSplit.date)).all()
    dividends = db.execute(select(Dividend.symbol, Dividend.ex_date).where(Dividend.symbol.in_(symbols)).order_by(Dividend.ex_date)).all()
    fx = db.execute(
        select(ExchangeRate.date, ExchangeRate.rate).where(ExchangeRate.from_ == Currency.USD, ExchangeRate.to == Currency.MYR).order_by(ExchangeRate.date)
    ).all()
    implied = db.execute(select(ImpliedSnapshot.symbol, ImpliedSnapshot.date).where(ImpliedSnapshot.symbol.in_(iv_symbols))).all()
    sync = _sync_health(db, expected["US"], now)

    benchmark_bars: dict[str, list[dict[str, Any]]] = {}
    for row in benchmarks:
        benchmark_bars.setdefault(row.symbol, []).append({"date": date_key(row.date), "close": float(row.close)})
    prices_by: dict[str, list[dict[str, Any]]] = {}
    for row in prices:
        prices_by.setdefault(row.symbol, []).append({"date": date_key(row.date), "close": float(row.close)})
    notes: list[str] = []

    def calendar_for(market: str, index: str) -> list[str]:
        index_dates = [bar["date"] for bar in benchmark_bars.get(index, [])]
        series = [{bar["date"] for bar in prices_by.get(symbol, [])} for symbol in symbols if _market_of(symbol) == market]
        result = traded_calendar(index_dates, series)
        if result["dropped"]:
            notes.append(
                f"{index} has a bar on {', '.join(result['dropped'])} but none of your {'US' if market == 'US' else 'Bursa'} names traded; treated as a holiday."
            )
        return result["calendar"]

    calendars = {"US": calendar_for("US", US_CALENDAR), "BURSA": calendar_for("BURSA", BURSA_CALENDAR)}
    splits_by: dict[str, list[dict[str, Any]]] = {}
    for split in splits:
        splits_by.setdefault(split.symbol, []).append({"date": date_key(split.date), "numerator": split.numerator, "denominator": split.denominator})
    ex_by: dict[str, list[str]] = {}
    for dividend in dividends:
        ex_by.setdefault(dividend.symbol, []).append(date_key(dividend.ex_date))
    iv_by: dict[str, list[str]] = {}
    for snapshot in implied:
        iv_by.setdefault(snapshot.symbol, []).append(date_key(snapshot.date))

    def iv_for(symbol: str) -> dict[str, Any]:
        return assess_iv_recording(iv_by.get(symbol, []), calendars["US"], expected["US"])

    rows: list[dict[str, Any]] = []
    for symbol in symbols:
        market = _market_of(symbol)
        symbol_splits = splits_by.get(symbol, [])
        ex_dates = ex_by.get(symbol, [])
        assessment = assess_price_series(prices_by.get(symbol, []), calendars[market], expected[market], splits=symbol_splits, ex_dates=ex_dates)
        rows.append(_row(symbol, "holding", market, assessment, iv_for(symbol) if market == "US" else None, len(symbol_splits), len(ex_dates)))

    for symbol in BENCHMARK_SYMBOLS:
        market = _market_of(symbol)
        assessment = assess_price_series(
            benchmark_bars.get(symbol, []), calendars[market], expected[market], is_calendar=symbol in (US_CALENDAR, BURSA_CALENDAR)
        )
        rows.append(_row(symbol, "benchmark", market, assessment, None))

    # FX is needed on any day either market trades, so it is checked against both calendars.
    fx_calendar = sorted(set(calendars["US"]) | set(calendars["BURSA"]))
    fx_expected = expected["US"] if expected["US"] > expected["BURSA"] else expected["BURSA"]
    rows.append(_row(FX_LABEL, "fx", None, assess_price_series([{"date": date_key(r.date), "close": float(r.rate)} for r in fx], fx_calendar, fx_expected), None))

    for symbol in IV_ALWAYS:
        if symbol not in symbols:
            rows.append(_row(symbol, "options", "US", None, iv_for(symbol)))

    rows.sort(key=lambda entry: (-status_rank(entry["status"]), locale_key(entry["symbol"])))
    counts = {"ok": 0, "warn": 0, "bad": 0}
    for entry in rows:
        counts[entry["status"]] += 1
    return {
        "generatedAt": iso(now),
        "expected": expected,
        "sync": sync,
        "counts": counts,
        "rows": rows,
        "notes": [
            *notes,
            f"Exchange calendars come from {US_CALENDAR} and {BURSA_CALENDAR} bars, so holidays are known only once the index skips them. Until then a holiday reads as one session behind.",
            "Implied-vol gaps cannot be backfilled: Yahoo serves only the current chain. Only gaps in the last 20 US sessions colour a row.",
        ],
    }
