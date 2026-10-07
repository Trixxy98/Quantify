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
