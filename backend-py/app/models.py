"""
SQLAlchemy mapping of the tables Prisma created. Table, column, index and
constraint names are the Prisma ones (PascalCase tables, camelCase columns),
so both APIs read and write the same rows and `alembic check` is clean.
Timestamps are naive UTC, as Prisma stores them.
"""

import enum
from datetime import date as DateType
from datetime import datetime
from decimal import Decimal
from typing import cast

from cuid2 import cuid_wrapper
from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, Table, Text
from sqlalchemy import Enum as SqlEnum
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.timeutil import utcnow

new_id = cuid_wrapper()


class Base(DeclarativeBase):
    pass


class TransactionType(enum.StrEnum):
    BUY = "BUY"
    SELL = "SELL"


class Exchange(enum.StrEnum):
    BURSA = "BURSA"
    US = "US"


class Currency(enum.StrEnum):
    MYR = "MYR"
    USD = "USD"


def _enum(kind: type[enum.Enum], name: str) -> SqlEnum:
    return SqlEnum(kind, name=name, create_type=False, native_enum=True, values_callable=lambda e: [m.value for m in e])


def _id() -> Mapped[str]:
    return mapped_column(Text, primary_key=True, default=new_id)


def table_of(model: type[Base]) -> Table:
    """The Core table of a mapped class, typed for insert() and on_conflict_*()."""
    return cast(Table, model.__table__)


def _fk(target: str, name: str, ondelete: str = "CASCADE") -> ForeignKey:
    return ForeignKey(target, name=name, ondelete=ondelete, onupdate="CASCADE")


def _created() -> Mapped[datetime]:
    return mapped_column("createdAt", DateTime, default=utcnow)


def _updated() -> Mapped[datetime]:
    return mapped_column("updatedAt", DateTime, default=utcnow, onupdate=utcnow)


class User(Base):
    __tablename__ = "User"
    __table_args__ = (Index("User_email_key", "email", unique=True),)
    id: Mapped[str] = _id()
    email: Mapped[str] = mapped_column(Text)
    password_hash: Mapped[str] = mapped_column("passwordHash", Text)
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class RefreshToken(Base):
    __tablename__ = "RefreshToken"
    __table_args__ = (
        Index("RefreshToken_tokenHash_key", "tokenHash", unique=True),
        Index("RefreshToken_userId_idx", "userId"),
    )
    id: Mapped[str] = _id()
    user_id: Mapped[str] = mapped_column("userId", Text, _fk("User.id", "RefreshToken_userId_fkey"))
    token_hash: Mapped[str] = mapped_column("tokenHash", Text)
    expires_at: Mapped[datetime] = mapped_column("expiresAt", DateTime)
    revoked_at: Mapped[datetime | None] = mapped_column("revokedAt", DateTime, nullable=True)
    created_at: Mapped[datetime] = _created()


class Portfolio(Base):
    __tablename__ = "Portfolio"
    __table_args__ = (Index("Portfolio_userId_idx", "userId"),)
    id: Mapped[str] = _id()
    user_id: Mapped[str] = mapped_column("userId", Text, _fk("User.id", "Portfolio_userId_fkey"))
    name: Mapped[str] = mapped_column(Text)
    base_currency: Mapped[Currency] = mapped_column("baseCurrency", _enum(Currency, "Currency"), default=Currency.MYR)
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class Holding(Base):
    __tablename__ = "Holding"
    __table_args__ = (
        Index("Holding_portfolioId_symbol_key", "portfolioId", "symbol", unique=True),
        Index("Holding_symbol_idx", "symbol"),
    )
    id: Mapped[str] = _id()
    portfolio_id: Mapped[str] = mapped_column("portfolioId", Text, _fk("Portfolio.id", "Holding_portfolioId_fkey"))
    symbol: Mapped[str] = mapped_column(Text)
    exchange: Mapped[Exchange] = mapped_column(_enum(Exchange, "Exchange"))
    currency: Mapped[Currency] = mapped_column(_enum(Currency, "Currency"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    avg_cost: Mapped[Decimal] = mapped_column("avgCost", Numeric(18, 6))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _updated()


class Transaction(Base):
    __tablename__ = "Transaction"
    __table_args__ = (
        Index("Transaction_portfolioId_date_idx", "portfolioId", "date"),
        Index("Transaction_symbol_idx", "symbol"),
    )
    id: Mapped[str] = _id()
    portfolio_id: Mapped[str] = mapped_column("portfolioId", Text, _fk("Portfolio.id", "Transaction_portfolioId_fkey"))
    symbol: Mapped[str] = mapped_column(Text)
    type: Mapped[TransactionType] = mapped_column(_enum(TransactionType, "TransactionType"))
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    price: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    currency: Mapped[Currency] = mapped_column(_enum(Currency, "Currency"))
    fee: Mapped[Decimal] = mapped_column(Numeric(18, 6), default=Decimal(0))
    date: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = _created()


class DailyPrice(Base):
    __tablename__ = "DailyPrice"
    __table_args__ = (
        Index("DailyPrice_symbol_date_key", "symbol", "date", unique=True),
        Index("DailyPrice_symbol_date_idx", "symbol", "date"),
    )
    id: Mapped[str] = _id()
    symbol: Mapped[str] = mapped_column(Text)
    date: Mapped[DateType] = mapped_column(Date)
    open: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    high: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    low: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    close: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    volume: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[Currency] = mapped_column(_enum(Currency, "Currency"))


class PortfolioSnapshot(Base):
    __tablename__ = "PortfolioSnapshot"
    __table_args__ = (
        Index("PortfolioSnapshot_portfolioId_date_key", "portfolioId", "date", unique=True),
        Index("PortfolioSnapshot_portfolioId_date_idx", "portfolioId", "date"),
    )
    id: Mapped[str] = _id()
    portfolio_id: Mapped[str] = mapped_column("portfolioId", Text, _fk("Portfolio.id", "PortfolioSnapshot_portfolioId_fkey"))
    date: Mapped[DateType] = mapped_column(Date)
    total_value: Mapped[Decimal] = mapped_column("totalValue", Numeric(18, 6))
    total_cost: Mapped[Decimal] = mapped_column("totalCost", Numeric(18, 6))
    dividend_income: Mapped[Decimal] = mapped_column("dividendIncome", Numeric(18, 6), default=Decimal(0))
    created_at: Mapped[datetime] = _created()


class StockSplit(Base):
    __tablename__ = "StockSplit"
    __table_args__ = (
        Index("StockSplit_symbol_date_key", "symbol", "date", unique=True),
        Index("StockSplit_symbol_date_idx", "symbol", "date"),
    )
    id: Mapped[str] = _id()
    symbol: Mapped[str] = mapped_column(Text)
    date: Mapped[DateType] = mapped_column(Date)
    numerator: Mapped[int] = mapped_column(Integer)
    denominator: Mapped[int] = mapped_column(Integer)


class Dividend(Base):
    __tablename__ = "Dividend"
    __table_args__ = (
        Index("Dividend_symbol_exDate_key", "symbol", "exDate", unique=True),
        Index("Dividend_symbol_exDate_idx", "symbol", "exDate"),
    )
    id: Mapped[str] = _id()
    symbol: Mapped[str] = mapped_column(Text)
    ex_date: Mapped[DateType] = mapped_column("exDate", Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    currency: Mapped[Currency] = mapped_column(_enum(Currency, "Currency"))


class ImpliedSnapshot(Base):
    __tablename__ = "ImpliedSnapshot"
    __table_args__ = (
        Index("ImpliedSnapshot_symbol_date_key", "symbol", "date", unique=True),
        Index("ImpliedSnapshot_symbol_date_idx", "symbol", "date"),
    )
    id: Mapped[str] = _id()
    symbol: Mapped[str] = mapped_column(Text)
    date: Mapped[DateType] = mapped_column(Date)
    expiry: Mapped[DateType] = mapped_column(Date)
    spot: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    strike: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    atm_iv: Mapped[Decimal] = mapped_column("atmIv", Numeric(12, 8))
    straddle_move: Mapped[Decimal] = mapped_column("straddleMove", Numeric(12, 8))
    created_at: Mapped[datetime] = _created()


class SyncRun(Base):
    __tablename__ = "SyncRun"
    __table_args__ = (Index("SyncRun_ok_finishedAt_idx", "ok", "finishedAt"),)
    id: Mapped[str] = _id()
    trigger: Mapped[str] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column("startedAt", DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column("finishedAt", DateTime, nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class AgentRun(Base):
    __tablename__ = "AgentRun"
    __table_args__ = (Index("AgentRun_agent_asOf_idx", "agent", "asOf"),)
    id: Mapped[str] = _id()
    agent: Mapped[str] = mapped_column(Text)
    as_of: Mapped[DateType] = mapped_column("asOf", Date)
    trigger: Mapped[str] = mapped_column(Text)
    model_version: Mapped[str] = mapped_column("modelVersion", Text)
    started_at: Mapped[datetime] = mapped_column("startedAt", DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column("finishedAt", DateTime, nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    rows: Mapped[int] = mapped_column(Integer, default=0)

    forecasts: Mapped[list["AgentForecast"]] = relationship(back_populates="run")


class AgentForecast(Base):
    __tablename__ = "AgentForecast"
    __table_args__ = (
        Index("AgentForecast_agent_symbol_asOf_horizon_target_key", "agent", "symbol", "asOf", "horizon", "target", unique=True),
        Index("AgentForecast_agent_asOf_idx", "agent", "asOf"),
    )
    id: Mapped[str] = _id()
    run_id: Mapped[str] = mapped_column("runId", Text, _fk("AgentRun.id", "AgentForecast_runId_fkey", ondelete="RESTRICT"))
    agent: Mapped[str] = mapped_column(Text)
    symbol: Mapped[str] = mapped_column(Text)
    as_of: Mapped[DateType] = mapped_column("asOf", Date)
    horizon: Mapped[str] = mapped_column(Text)
    target: Mapped[str] = mapped_column(Text)
    value: Mapped[Decimal] = mapped_column(Numeric(18, 10))
    model_version: Mapped[str] = mapped_column("modelVersion", Text)
    created_at: Mapped[datetime] = _created()

    run: Mapped[AgentRun] = relationship(back_populates="forecasts")


class AgentDecision(Base):
    """Append-only one-month book. A later pass does not rewrite a month that already has rows."""

    __tablename__ = "AgentDecision"
    __table_args__ = (Index("AgentDecision_asOf_symbol_key", "asOf", "symbol", unique=True),)
    id: Mapped[str] = _id()
    as_of: Mapped[DateType] = mapped_column("asOf", Date)
    symbol: Mapped[str] = mapped_column(Text)
    weight: Mapped[Decimal] = mapped_column(Numeric(18, 10))
    action: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    rules: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _created()


class NewsHeadline(Base):
    __tablename__ = "NewsHeadline"
    __table_args__ = (
        Index("NewsHeadline_symbol_sourceId_key", "symbol", "sourceId", unique=True),
        Index("NewsHeadline_symbol_published_idx", "symbol", "published"),
    )
    id: Mapped[str] = _id()
    symbol: Mapped[str] = mapped_column(Text)
    source_id: Mapped[str] = mapped_column("sourceId", Text)
    published: Mapped[datetime] = mapped_column(DateTime)
    title: Mapped[str] = mapped_column(Text)
    publisher: Mapped[str] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column("recordedAt", DateTime, default=utcnow)


class EarningsDate(Base):
    """Announcement dates derived from Yahoo 10-Q/10-K filings. Yahoo has no separate history feed, so the sync stores them."""

    __tablename__ = "EarningsDate"
    __table_args__ = (Index("EarningsDate_symbol_date_key", "symbol", "date", unique=True),)
    id: Mapped[str] = _id()
    symbol: Mapped[str] = mapped_column(Text)
    date: Mapped[DateType] = mapped_column(Date)
    recorded_at: Mapped[datetime] = mapped_column("recordedAt", DateTime, default=utcnow)


class FactorReturn(Base):
    __tablename__ = "FactorReturn"
    __table_args__ = (Index("FactorReturn_factor_date_idx", "factor", "date"),)
    date: Mapped[DateType] = mapped_column(Date, primary_key=True)
    factor: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[Decimal] = mapped_column(Numeric(16, 10))


class BenchmarkPrice(Base):
    __tablename__ = "BenchmarkPrice"
    __table_args__ = (
        Index("BenchmarkPrice_symbol_date_key", "symbol", "date", unique=True),
        Index("BenchmarkPrice_symbol_date_idx", "symbol", "date"),
    )
    id: Mapped[str] = _id()
    symbol: Mapped[str] = mapped_column(Text)
    date: Mapped[DateType] = mapped_column(Date)
    close: Mapped[Decimal] = mapped_column(Numeric(18, 6))


class ExchangeRate(Base):
    __tablename__ = "ExchangeRate"
    __table_args__ = (Index("ExchangeRate_from_to_date_key", "from", "to", "date", unique=True),)
    id: Mapped[str] = _id()
    from_: Mapped[Currency] = mapped_column("from", _enum(Currency, "Currency"))
    to: Mapped[Currency] = mapped_column(_enum(Currency, "Currency"))
    date: Mapped[DateType] = mapped_column(Date)
    rate: Mapped[Decimal] = mapped_column(Numeric(18, 8))
