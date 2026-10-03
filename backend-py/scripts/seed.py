"""
Adds sample trades to the first portfolio of SEED_EMAIL (default demo@quantify.local).
Register that account and create a portfolio first. Safe to re-run: existing trades are skipped.

Usage: SEED_EMAIL=you@example.com uv run python scripts/seed.py
"""

import os
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import Portfolio, Transaction, TransactionType, User  # noqa: E402
from app.rows import currency_from_symbol  # noqa: E402
from app.services.portfolio import recompute_portfolio_holdings  # noqa: E402
from app.services.refresh import refresh_portfolio_after_trade  # noqa: E402

SEED_EMAIL = os.environ.get("SEED_EMAIL", "demo@quantify.local")
TRADES = [
    ("5347.KL", "BUY", 200, 13.8, 12, "2025-04-10"),
    ("5183.KL", "BUY", 500, 4.2, 10, "2025-06-12"),
    ("5225.KL", "BUY", 200, 6.9, 8, "2025-07-22"),
    ("4863.KL", "BUY", 300, 6.5, 9, "2025-10-08"),
    ("8869.KL", "BUY", 400, 4.8, 10, "2025-11-18"),
    ("MSFT", "BUY", 8, 415, 5, "2025-12-04"),
    ("NVDA", "BUY", 10, 128, 5, "2026-02-12"),
    ("GOOGL", "BUY", 12, 165, 5, "2026-03-20"),
    ("1155.KL", "SELL", 80, 10.2, 8, "2026-05-15"),
    ("7113.KL", "BUY", 1000, 0.95, 6, "2026-06-10"),
    ("1295.KL", "BUY", 200, 4.4, 7, "2026-07-02"),
]


def main() -> None:
    with SessionLocal() as db:
        user = db.scalars(select(User).where(User.email == SEED_EMAIL)).first()
        if user is None:
            raise SystemExit(f"No user {SEED_EMAIL}. Set SEED_EMAIL or register that account first.")
        portfolio = db.scalars(select(Portfolio).where(Portfolio.user_id == user.id, Portfolio.name == "Main Portfolio")).first() or db.scalars(
            select(Portfolio).where(Portfolio.user_id == user.id).order_by(Portfolio.created_at)
        ).first()
        if portfolio is None:
            raise SystemExit(f"No portfolio for {SEED_EMAIL}")

        inserted = 0
        for symbol, kind, quantity, price, fee, day in TRADES:
            date = datetime.fromisoformat(day)
            exists = db.scalars(
                select(Transaction.id).where(
                    Transaction.portfolio_id == portfolio.id,
                    Transaction.symbol == symbol,
                    Transaction.type == TransactionType(kind),
                    Transaction.date == date,
                    Transaction.quantity == Decimal(str(quantity)),
                    Transaction.price == Decimal(str(price)),
                )
            ).first()
            if exists:
                continue
            db.add(
                Transaction(
                    portfolio_id=portfolio.id,
                    symbol=symbol,
                    type=TransactionType(kind),
                    quantity=Decimal(str(quantity)),
                    price=Decimal(str(price)),
                    fee=Decimal(str(fee)),
                    currency=currency_from_symbol(symbol),
                    date=date,
                )
            )
            inserted += 1
        db.commit()
        recompute_portfolio_holdings(db, portfolio.id)
        symbols = list(dict.fromkeys(trade[0] for trade in TRADES))
        print(f'Inserted {inserted} trades into "{portfolio.name}". Refreshing prices for {len(symbols)} symbols…')
        refresh_portfolio_after_trade(db, portfolio.id, symbols)
        print("Done. Switch to that portfolio and open Overview / Analysis / Holdings.")


if __name__ == "__main__":
    main()
