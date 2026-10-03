import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.jsonenc import OMIT, NodeJSONResponse

log = logging.getLogger("quantify")


class AppError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: Any = OMIT):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def _field_errors(exc: RequestValidationError) -> dict[str, list[str]]:
    """Shape of zod's `flatten().fieldErrors`: field name to messages."""
    out: dict[str, list[str]] = {}
    for error in exc.errors():
        location = [str(part) for part in error.get("loc", ()) if part not in ("body", "query", "path")]
        key = location[0] if location else "_"
        out.setdefault(key, []).append(str(error.get("msg", "Invalid")))
    return out


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(_request: Request, exc: AppError) -> NodeJSONResponse:
        return NodeJSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError) -> NodeJSONResponse:
        return NodeJSONResponse(
            status_code=400,
            content={"error": {"code": "VALIDATION_ERROR", "message": "Invalid input", "details": _field_errors(exc)}},
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException) -> NodeJSONResponse:
        if exc.status_code == 404:
            return NodeJSONResponse(status_code=404, content={"error": {"code": "NOT_FOUND", "message": "Route not found"}})
        return NodeJSONResponse(status_code=exc.status_code, content={"error": {"code": "HTTP_ERROR", "message": str(exc.detail)}})

    @app.exception_handler(Exception)
    async def internal_error(_request: Request, exc: Exception) -> NodeJSONResponse:
        log.exception("unhandled error", exc_info=exc)
        return NodeJSONResponse(status_code=500, content={"error": {"code": "INTERNAL_ERROR", "message": "Internal server error"}})
