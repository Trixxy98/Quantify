from datetime import date, datetime
from decimal import Decimal

from fastapi.testclient import TestClient

from app.config import cors_origins, settings
from app.db import sqlalchemy_url
from app.jsonenc import to_jsonable
from app.main import app

client = TestClient(app)


def test_health() -> None:
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["timestamp"].endswith("Z") and len(body["timestamp"]) == 24


def test_cors_origins_pairs_loopback_hosts() -> None:
    assert cors_origins("http://localhost:5173") == ["http://localhost:5173", "http://127.0.0.1:5173"]
    assert cors_origins("http://127.0.0.1:5173") == ["http://127.0.0.1:5173", "http://localhost:5173"]
    assert cors_origins("http://localhost:5173, http://127.0.0.1:5173") == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


def test_login_preflight_accepts_either_loopback() -> None:
    origins = cors_origins(settings.CORS_ORIGIN)
    for origin in origins:
        response = client.options(
            "/api/auth/login",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin


def test_unknown_route_uses_node_envelope() -> None:
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "NOT_FOUND", "message": "Route not found"}}


def test_protected_route_without_token() -> None:
    response = client.get("/api/portfolios")
    assert response.status_code == 401
    assert response.json() == {"error": {"code": "UNAUTHORIZED", "message": "Token is required"}}


def test_json_matches_prisma_and_express() -> None:
    assert to_jsonable(datetime(2026, 10, 3, 4, 15, 32, 904000)) == "2026-10-03T04:15:32.904Z"
    assert to_jsonable(date(2026, 9, 30)) == "2026-09-30T00:00:00.000Z"
    assert to_jsonable(Decimal("12.500000")) == "12.5"
    assert to_jsonable(Decimal("100.000000")) == "100"
    assert to_jsonable(Decimal("0.000000")) == "0"
    assert to_jsonable(float("nan")) is None


def test_prisma_url_is_converted() -> None:
    assert sqlalchemy_url("postgresql://u:p@localhost:5434/quantify?schema=public") == "postgresql+psycopg://u:p@localhost:5434/quantify"
