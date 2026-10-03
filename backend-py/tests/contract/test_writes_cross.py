"""
The same trades written through each API leave the same holdings, snapshots
and analytics. One throwaway user, one portfolio per backend, deleted after.
"""

import os
import uuid
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db import SessionLocal
from app.main import app
from app.models import User
from tests.contract.diff import compare

pytestmark = pytest.mark.contract
NODE = os.environ.get("NODE_API", "http://localhost:4000")
IDENTITY_KEYS = {"id", "portfolioId", "createdAt", "updatedAt", "transactionId"}

TRADES = [
    {"symbol": "aapl", "type": "BUY", "quantity": 10, "price": 150, "currency": "USD", "fee": 1, "date": "2025-01-02"},
    {"symbol": "1155.KL", "type": "BUY", "quantity": 1000, "price": "9.5", "currency": "MYR", "fee": 10, "date": "2025-02-03T00:00:00.000Z"},
    {"symbol": "AAPL", "type": "SELL", "quantity": 4, "price": 190, "currency": "USD", "fee": 1, "date": "2025-05-02"},
    {"symbol": "NVDA", "type": "BUY", "quantity": 3, "price": 120, "currency": "USD", "date": "2025-03-03"},
]


def _node_up() -> bool:
    try:
        return httpx.get(f"{NODE}/health", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False


def _strip(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _strip(item) for key, item in value.items() if key not in IDENTITY_KEYS}
    if isinstance(value, list):
        return [_strip(item) for item in value]
    return value


@pytest.mark.skipif(not _node_up(), reason="Node API not running")
def test_same_writes_same_state() -> None:
    py = TestClient(app)
    email = f"parity-{uuid.uuid4().hex[:10]}@example.com"
    try:
        tokens = httpx.post(f"{NODE}/api/auth/register", json={"email": email, "password": "parity-password-1", "name": "Parity"}).json()
        headers = {"Authorization": f"Bearer {tokens['accessToken']}"}

        def node(method: str, path: str, **kwargs: Any) -> httpx.Response:
            return httpx.request(method, f"{NODE}{path}", headers=headers, timeout=300, **kwargs)

        def python(method: str, path: str, **kwargs: Any) -> Any:
            return py.request(method, path, headers=headers, **kwargs)

        created_node = node("POST", "/api/portfolios", json={"name": "Parity", "baseCurrency": "MYR"})
        created_py = python("POST", "/api/portfolios", json={"name": "Parity", "baseCurrency": "MYR"})
        assert created_node.status_code == created_py.status_code == 201
        assert _strip(created_node.json()) == _strip(created_py.json())
        pn, pp = created_node.json()["id"], created_py.json()["id"]

        ids_node, ids_py = [], []
        for trade in TRADES:
            a = node("POST", f"/api/portfolios/{pn}/transactions", json=trade)
            b = python("POST", f"/api/portfolios/{pp}/transactions", json=trade)
            assert a.status_code == b.status_code == 201, (a.text, b.text)
            assert _strip(a.json()) == _strip(b.json())
            ids_node.append(a.json()["id"])
            ids_py.append(b.json()["id"])

        oversell = {"symbol": "AAPL", "type": "SELL", "quantity": 50, "price": 200, "currency": "USD", "date": "2025-06-02"}
        a = node("POST", f"/api/portfolios/{pn}/transactions", json=oversell)
        b = python("POST", f"/api/portfolios/{pp}/transactions", json=oversell)
        assert a.status_code == b.status_code == 400 and a.json() == b.json()

        edit = {**TRADES[0], "quantity": 12, "price": 151.25}
        a = node("PATCH", f"/api/portfolios/{pn}/transactions/{ids_node[0]}", json=edit)
        b = python("PATCH", f"/api/portfolios/{pp}/transactions/{ids_py[0]}", json=edit)
        assert a.status_code == b.status_code == 200 and _strip(a.json()) == _strip(b.json())
        assert node("DELETE", f"/api/portfolios/{pn}/transactions/{ids_node[3]}").status_code == 204
        assert python("DELETE", f"/api/portfolios/{pp}/transactions/{ids_py[3]}").status_code == 204

        bad = {"symbol": "", "type": "HOLD", "quantity": -1, "price": 0, "currency": "EUR", "date": "nope"}
        a = node("POST", f"/api/portfolios/{pn}/transactions", json=bad)
        b = python("POST", f"/api/portfolios/{pp}/transactions", json=bad)
        assert a.status_code == b.status_code == 400
        assert sorted(a.json()["error"]["details"]) == sorted(b.json()["error"]["details"])

        for suffix, params in [
            ("/holdings", {}),
            ("/summary", {}),
            ("/closed-lots", {}),
            ("/transactions", {"limit": 50}),
            ("/allocation", {}),
            ("/performance", {"range": "ALL"}),
            ("/metrics", {"range": "ALL"}),
        ]:
            a = node("GET", f"/api/portfolios/{pn}{suffix}", params=params)
            b = python("GET", f"/api/portfolios/{pp}{suffix}", params=params)
            assert a.status_code == b.status_code, suffix
            found: list[tuple[str, Any, Any]] = []
            compare(_strip(a.json()), _strip(b.json()), suffix, "exact", found)
            assert not found, found[:5]
    finally:
        with SessionLocal() as db:
            db.execute(delete(User).where(User.email.like("parity-%@example.com")))
            db.commit()
