"""Password hashing and JWTs, byte-compatible with the Node API (bcryptjs, jsonwebtoken HS256)."""

import hashlib
import re
import time
import uuid
from typing import Any

import bcrypt
import jwt

from app.config import settings

SALT_ROUNDS = 10
_UNITS = {"ms": 0.001, "s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800, "y": 31557600}


def parse_expires_in(value: str) -> int:
    """Seconds for a jsonwebtoken `expiresIn` such as "15m", "30d" or "3600"."""
    text = value.strip().lower()
    if text.isdigit():
        return int(text)
    match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w|y)", text)
    if not match:
        raise ValueError(f"unsupported expiresIn: {value}")
    return int(float(match.group(1)) * _UNITS[match.group(2)])


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(SALT_ROUNDS)).decode()


def compare_password(password: str, password_hash: str) -> bool:
    # bcryptjs writes $2a$ hashes; the C library verifies them unchanged.
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _sign(payload: dict[str, Any], secret: str, expires_in: str) -> str:
    now = int(time.time())
    return jwt.encode({**payload, "iat": now, "exp": now + parse_expires_in(expires_in)}, secret, algorithm="HS256")


def sign_access_token(user_id: str) -> str:
    return _sign({"sub": user_id}, settings.JWT_ACCESS_SECRET, settings.JWT_ACCESS_EXPIRES_IN)


def sign_refresh_token(user_id: str, jti: str) -> str:
    return _sign({"sub": user_id, "jti": jti}, settings.JWT_REFRESH_SECRET, settings.JWT_REFRESH_EXPIRES_IN)


def verify_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.JWT_ACCESS_SECRET, algorithms=["HS256"])


def verify_refresh_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.JWT_REFRESH_SECRET, algorithms=["HS256"])


def decode_unverified(token: str) -> dict[str, Any]:
    return jwt.decode(token, options={"verify_signature": False})


def new_jti() -> str:
    return str(uuid.uuid4())
