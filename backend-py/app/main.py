import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import cors_origins, settings
from app.errors import install_error_handlers
from app.jsonenc import NodeJSONResponse
from app.routers import auth, events, market, portfolios, research, sync
from app.timeutil import iso, utcnow

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("quantify")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    scheduler = None
    if settings.SCHEDULER_ENABLED:
        from app.jobs.scheduler import start_scheduler

        scheduler = start_scheduler()
    else:
        log.info("[sync] Scheduler disabled (SCHEDULER_ENABLED=false); no daily sync or startup catch-up in this process")
    yield
    if scheduler is not None:
        scheduler.shutdown(wait=False)


app = FastAPI(title="Quantify API", default_response_class=NodeJSONResponse, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(settings.CORS_ORIGIN),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
install_error_handlers(app)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "timestamp": iso(utcnow())}


app.include_router(auth.router, prefix="/api/auth")
app.include_router(portfolios.router, prefix="/api/portfolios")
app.include_router(sync.router, prefix="/api/sync")
app.include_router(market.router, prefix="/api/market")
app.include_router(events.router, prefix="/api/events")
app.include_router(research.router, prefix="/api/research")
