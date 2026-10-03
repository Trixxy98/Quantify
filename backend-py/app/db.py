from collections.abc import Iterator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings


def sqlalchemy_url(prisma_url: str) -> str:
    """Prisma URLs carry `?schema=public`, which libpq rejects, and a bare postgresql scheme."""
    parts = urlsplit(prisma_url)
    query = urlencode([(key, value) for key, value in parse_qsl(parts.query) if key != "schema"])
    scheme = "postgresql+psycopg" if parts.scheme in ("postgres", "postgresql") else parts.scheme
    return urlunsplit((scheme, parts.netloc, parts.path, query, parts.fragment))


engine = create_engine(sqlalchemy_url(settings.DATABASE_URL), pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
