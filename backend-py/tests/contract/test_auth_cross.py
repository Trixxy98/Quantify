"""
Tokens and password hashes are interchangeable between the Node API and this one.
Runs against the live Node API (NODE_API, default :4000) and this app in-process,
with a throwaway user that is deleted afterwards.
"""

import os
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db import SessionLocal
from app.main import app
from app.models import User

pytestmark = pytest.mark.contract
NODE = os.environ.get("NODE_API", "http://localhost:4000")


def _node_up() -> bool:
    try:
        return httpx.get(f"{NODE}/health", timeout=2).status_code == 200
    except httpx.HTTPError:
        return False


@pytest.mark.skipif(not _node_up(), reason="Node API not running")
def test_tokens_and_hashes_cross_over() -> None:
    py = TestClient(app)
    email = f"parity-{uuid.uuid4().hex[:10]}@example.com"
    password = "parity-password-1"
    try:
        # bcryptjs hash written by Node, verified by Python.
        registered = httpx.post(f"{NODE}/api/auth/register", json={"email": email, "password": password, "name": "Parity"})
        assert registered.status_code == 201
        login = py.post("/api/auth/login", json={"email": email, "password": password})
        assert login.status_code == 200, login.text
        assert login.json()["user"]["email"] == email

        # Python access token on Node, Node access token on Python.
        node_tokens = registered.json()
        assert httpx.get(f"{NODE}/api/portfolios", headers={"Authorization": f"Bearer {login.json()['accessToken']}"}).status_code == 200
        assert py.get("/api/auth/nope").status_code == 404

        # Refresh rotation across both: Node's token refreshed by Python, then Python's by Node.
        rotated = py.post("/api/auth/refresh", json={"refreshToken": node_tokens["refreshToken"]})
        assert rotated.status_code == 200, rotated.text
        reused = httpx.post(f"{NODE}/api/auth/refresh", json={"refreshToken": node_tokens["refreshToken"]})
        assert reused.status_code == 401
        back = httpx.post(f"{NODE}/api/auth/refresh", json={"refreshToken": rotated.json()["refreshToken"]})
        assert back.status_code == 200

        # Python-hashed password verified by Node.
        second = f"parity-{uuid.uuid4().hex[:10]}@example.com"
        assert py.post("/api/auth/register", json={"email": second, "password": password, "name": "Parity"}).status_code == 201
        assert httpx.post(f"{NODE}/api/auth/login", json={"email": second, "password": password}).status_code == 200

        bad = py.post("/api/auth/login", json={"email": "not-an-email", "password": ""})
        node_bad = httpx.post(f"{NODE}/api/auth/login", json={"email": "not-an-email", "password": ""})
        assert bad.status_code == node_bad.status_code == 400
        assert bad.json() == node_bad.json()
    finally:
        with SessionLocal() as db:
            db.execute(delete(User).where(User.email.like("parity-%@example.com")))
            db.commit()
