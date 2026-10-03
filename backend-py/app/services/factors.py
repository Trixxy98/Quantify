import io
import logging
import zipfile
from datetime import date, timedelta
from typing import Any

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import DailyPrice, FactorReturn, Transaction, TransactionType, table_of
from app.research.french import FACTOR_NAMES, FF5_URL, MOMENTUM_URL, parse_french_daily
from app.research.ols import CollinearError, ols
from app.services.corporate_actions import adjust_trade, load_dividends, load_splits
from app.services.date_range import resolve_range_start
from app.services.fx import SeriesPoint, latest_at_or_before
from app.services.portfolio import get_owned_portfolio
from app.timeutil import date_key, day_ms, from_ms, ms, utcnow

log = logging.getLogger("quantify")
HAC_LAG = 5
MIN_OBSERVATIONS = 120
ROLLING = 252
ANNUALIZATION = 252
# Re-download when the stored tail is older than this. French publishes monthly.
REFRESH_AFTER_DAYS = 7
# Say so when the tail is older than this: a monthly publication plus a week of delay.
STALE_AFTER_DAYS = 45


def _download_csv(url: str) -> str:
    response = httpx.get(url, timeout=120, follow_redirects=True)
    if response.status_code != 200:
        raise RuntimeError(f"Ken French download failed ({response.status_code}) for {url}")
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        return archive.read(archive.namelist()[0]).decode("utf-8")


def refresh_factors(db: Session) -> dict[str, Any]:
    ff5 = parse_french_daily(_download_csv(FF5_URL))
    momentum = parse_french_daily(_download_csv(MOMENTUM_URL))
    by_date: dict[str, dict[str, float]] = {}
    for row in [*ff5, *momentum]:
        by_date.setdefault(row["date"], {}).update(row["values"])
    data = [
        {"date": date.fromisoformat(day), "factor": factor, "value": value}
        for day, values in by_date.items()
        for factor, value in values.items()
    ]
    try:
        db.execute(delete(FactorReturn))
        for start in range(0, len(data), 5000):
            db.execute(insert(table_of(FactorReturn)).values(data[start : start + 5000]))
        db.commit()
    except Exception:
        db.rollback()
        raise
    through = max(by_date) if by_date else None
    log.info("[factors] stored %s rows through %s", len(data), through)
    return {"rows": len(data), "through": through}


def refresh_factors_if_stale(db: Session) -> dict[str, Any]:
    """Downloads only when the table is empty or the tail is older than a week."""
    latest = db.scalar(select(func.max(FactorReturn.date)))
    age = (ms(utcnow()) - day_ms(latest)) / 86_400_000 if latest else float("inf")
    if age < REFRESH_AFTER_DAYS:
        return {"refreshed": False, "through": date_key(latest) if latest else None}
    try:
        return {"refreshed": True, "through": refresh_factors(db)["through"]}
    except Exception:
        log.exception("[factors] refresh failed")
        return {"refreshed": False, "through": date_key(latest) if latest else None}


def _us_sleeve_returns(db: Session, portfolio_id: str) -> tuple[list[str], list[dict[str, Any]]]:
    """
    Daily time-weighted return of the US names only, in USD. Bursa holdings are
    left out: these factors were estimated on US stocks.
    """
    transactions = db.scalars(
        select(Transaction).where(Transaction.portfolio_id == portfolio_id).order_by(Transaction.date, Transaction.created_at)
    ).all()
    us = [t for t in transactions if "." not in t.symbol]
    symbols = sorted({t.symbol for t in us})
    if not symbols:
        return symbols, []
    from sqlalchemy import DateTime, cast

    prices = db.execute(
        select(DailyPrice.symbol, DailyPrice.date, DailyPrice.close)
        .where(DailyPrice.symbol.in_(symbols), cast(DailyPrice.date, DateTime) >= us[0].date)
        .order_by(DailyPrice.date)
    ).all()
    splits = load_splits(db, symbols)
    dividend_rows = load_dividends(db, symbols)

    price_map: dict[str, list[SeriesPoint]] = {}
    calendar: set[int] = set()
    for row in prices:
        time = day_ms(row.date)
        calendar.add(time)
        price_map.setdefault(row.symbol, []).append({"date": time, "close": float(row.close)})
    days = sorted(calendar)
    if not days:
        return symbols, []
    dividends = sorted(
        ((day_ms(row.ex_date), symbol, row.amount) for symbol, rows in dividend_rows.items() for row in rows), key=lambda event: event[0]
    )

    qty: dict[str, float] = {}
    tx_index = 0
    div_index = 0
    points: list[dict[str, Any]] = []
    for time in days:
        cash_flow = 0.0
        while tx_index < len(us) and ms(us[tx_index].date) <= time:
            tx = us[tx_index]
            quantity = adjust_trade(float(tx.quantity), float(tx.price), splits.get(tx.symbol, []), ms(tx.date))["quantity"]
            notional = float(tx.quantity) * float(tx.price)
            fee = float(tx.fee)
            cash_flow += notional + fee if tx.type == TransactionType.BUY else -(notional - fee)
            qty[tx.symbol] = qty.get(tx.symbol, 0.0) + (quantity if tx.type == TransactionType.BUY else -quantity)
            tx_index += 1
        income = 0.0
        while div_index < len(dividends) and dividends[div_index][0] <= time:
            _, symbol, amount = dividends[div_index]
            held = qty.get(symbol, 0.0)
            if held > 0:
                income += held * amount
            div_index += 1
        value = 0.0
        for symbol in symbols:
            held = qty.get(symbol, 0.0)
            if held <= 0:
                continue
            close = latest_at_or_before(price_map.get(symbol, []), time)
            if close is not None:
                value += held * close
        points.append({"date": date_key(from_ms(time)), "value": value, "cashFlow": cash_flow, "income": income})

    returns = []
    for i in range(1, len(points)):
        prev = points[i - 1]["value"]
        if not prev > 1e-6:
            continue
        returns.append({"date": points[i]["date"], "ret": (points[i]["value"] - prev - points[i]["cashFlow"] + points[i]["income"]) / prev})
    return symbols, returns


def get_factor_exposure(db: Session, portfolio_id: str, user_id: str, range_: str) -> dict[str, Any]:
    get_owned_portfolio(db, portfolio_id, user_id)
    notes = [
        "US holdings only, measured in USD. Bursa names are excluded: these factors were estimated on US stocks, and converting the sleeve to ringgit would book the currency as alpha.",
        "Alpha is the annualized intercept (daily × 252) and its standard error scales by 252 as well, so the t-statistic is unchanged. t-statistics use Newey–West standard errors with 5 lags.",
        "Backtests built on this will charge 5 bps commission and 5 bps slippage per unit of turnover.",
    ]
    latest = db.scalar(select(func.max(FactorReturn.date)))
    data_through = date_key(latest) if latest else None
    symbols, returns = _us_sleeve_returns(db, portfolio_id)
    empty: dict[str, Any] = {
        "symbols": symbols,
        "n": 0,
        "dataThrough": data_through,
        "alpha": None,
        "alphaSe": None,
        "alphaT": None,
        "rSquared": None,
        "loadings": None,
        "rolling": [],
        "notes": notes,
    }
    if not symbols:
        notes.append("This portfolio has no US holdings, so there is nothing to regress.")
        return empty
    if latest is None:
        notes.append("No factor data stored yet. Run uv run python scripts/refresh_factors.py in backend-py.")
        return empty

    start = resolve_range_start(range_)
    conditions = [FactorReturn.date >= start - timedelta(days=420)] if start else []
    rows = db.execute(select(FactorReturn.date, FactorReturn.factor, FactorReturn.value).where(*conditions).order_by(FactorReturn.date)).all()
    by_date: dict[str, dict[str, float]] = {}
    for row in rows:
        by_date.setdefault(date_key(row.date), {})[row.factor] = float(row.value)

    aligned = []
    for point in returns:
        factors = by_date.get(point["date"])
        if not factors:
            continue
        rf = factors.get("RF")
        x = [factors.get(name) for name in FACTOR_NAMES]
        if rf is None or any(value is None for value in x):
            continue
        aligned.append({"date": point["date"], "y": point["ret"] - rf, "x": x})

    start_key = date_key(start) if start else None
    sample = [row for row in aligned if start_key is None or row["date"] >= start_key]
    age_days = (ms(utcnow()) - day_ms(latest)) / 86_400_000
    if age_days > STALE_AFTER_DAYS:
        notes.append(f"Ken French data runs through {data_through} and is published monthly, so the last few weeks are not in the regression.")
    else:
        notes.append(f"Ken French data runs through {data_through}.")
    notes.append(f"Regressed on {', '.join(symbols)}.")

    if len(sample) < MIN_OBSERVATIONS:
        notes.append(f"Loadings need {MIN_OBSERVATIONS} overlapping sessions; this range has {len(sample)}.")
        return {**empty, "n": len(sample), "notes": notes}

    fit = ols([row["y"] for row in sample], [row["x"] for row in sample], HAC_LAG)
    loadings = [{"factor": factor, "beta": fit["beta"][i + 1], "se": fit["se"][i + 1], "tStat": fit["tStat"][i + 1]} for i, factor in enumerate(FACTOR_NAMES)]

    rolling = []
    for end in range(ROLLING - 1, len(aligned)):
        day = aligned[end]["date"]
        if start_key and day < start_key:
            continue
        window = aligned[end - ROLLING + 1 : end + 1]
        try:
            rolled = ols([row["y"] for row in window], [row["x"] for row in window], HAC_LAG)
        except CollinearError:
            continue
        rolling.append(
            {
                "date": day,
                "alpha": rolled["beta"][0] * ANNUALIZATION,
                "loadings": [{"factor": factor, "beta": rolled["beta"][i + 1]} for i, factor in enumerate(FACTOR_NAMES)],
            }
        )
    if rolling:
        notes.append("Each rolling point uses the trailing 252 sessions, which can start before the selected range.")
    else:
        notes.append(f"Rolling loadings need {ROLLING} sessions of history before each point.")

    return {
        "symbols": symbols,
        "n": fit["n"],
        "dataThrough": data_through,
        "alpha": fit["beta"][0] * ANNUALIZATION,
        # A coefficient scales with its standard error; √252 is for a volatility.
        "alphaSe": fit["se"][0] * ANNUALIZATION,
        "alphaT": fit["tStat"][0],
        "rSquared": fit["rSquared"],
        "loadings": loadings,
        "rolling": rolling,
        "notes": notes,
    }
