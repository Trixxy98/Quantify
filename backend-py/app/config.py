from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend-py/.env whatever the working directory; the repo root .env is Compose's.
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    NODE_ENV: Literal["development", "production", "test"] = "development"
    API_PORT: int = Field(default=4000, ge=0, le=65535)
    DATABASE_URL: str = Field(min_length=1)
    # One origin, or several separated by commas. localhost and 127.0.0.1 are paired below.
    CORS_ORIGIN: str = "http://localhost:5173"
    JWT_ACCESS_SECRET: str = Field(min_length=32)
    JWT_REFRESH_SECRET: str = Field(min_length=32)
    JWT_ACCESS_EXPIRES_IN: str = "15m"
    JWT_REFRESH_EXPIRES_IN: str = "30d"
    RISK_FREE_RATE: float = Field(default=0.03, ge=0, le=1)
    # The daily cron and startup catch-up. Only one process may own them.
    SCHEDULER_ENABLED: bool = False
    FRED_API_KEY: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()


def cors_origins(configured: str) -> list[str]:
    """Allow the configured origin, and its localhost / 127.0.0.1 twin.

    The Vite dev server is the same app on either host. A page opened at
    127.0.0.1 otherwise fails the login preflight with 400.
    """
    raw = [part.strip().rstrip("/") for part in configured.split(",") if part.strip()]
    expanded: list[str] = []
    for origin in raw:
        expanded.append(origin)
        if "://localhost" in origin:
            expanded.append(origin.replace("://localhost", "://127.0.0.1", 1))
        elif "://127.0.0.1" in origin:
            expanded.append(origin.replace("://127.0.0.1", "://localhost", 1))
    seen: set[str] = set()
    unique: list[str] = []
    for origin in expanded:
        if origin not in seen:
            seen.add(origin)
            unique.append(origin)
    return unique
