"""`uv run python -m app` serves the API on API_PORT. Add `--reload` while developing."""

import sys

import uvicorn

from app.config import settings

if __name__ == "__main__":
    # Localhost only: this is a personal app with JWTs in the client, not something for the LAN.
    uvicorn.run("app.main:app", host="127.0.0.1", port=settings.API_PORT, reload="--reload" in sys.argv, reload_dirs=["app"] if "--reload" in sys.argv else None)
