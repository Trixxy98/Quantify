from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models import RefreshToken, User
from app.security import (
    compare_password,
    decode_unverified,
    hash_password,
    hash_token,
    new_jti,
    sign_access_token,
    sign_refresh_token,
    verify_refresh_token,
)
from app.timeutil import from_ms, utcnow


def _issue_token_pair(db: Session, user_id: str) -> dict[str, str]:
    access = sign_access_token(user_id)
    refresh = sign_refresh_token(user_id, new_jti())
    expires_at = from_ms(decode_unverified(refresh)["exp"] * 1000)
    db.add(RefreshToken(user_id=user_id, token_hash=hash_token(refresh), expires_at=expires_at))
    db.commit()
    return {"accessToken": access, "refreshToken": refresh}


def _user_view(user: User) -> dict[str, str]:
    return {"id": user.id, "email": user.email, "name": user.name}


def register(db: Session, email: str, password: str, name: str) -> dict:
    if db.scalars(select(User).where(User.email == email)).first():
        raise AppError(409, "EMAIL_TAKEN", "Email already in use")
    user = User(email=email, password_hash=hash_password(password), name=name)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise AppError(409, "EMAIL_TAKEN", "Email already in use") from err
    return {"user": _user_view(user), **_issue_token_pair(db, user.id)}


def login(db: Session, email: str, password: str) -> dict:
    user = db.scalars(select(User).where(User.email == email)).first()
    if user is None or not compare_password(password, user.password_hash):
        raise AppError(401, "INVALID_CREDENTIALS", "Incorrect email or password")
    return {"user": _user_view(user), **_issue_token_pair(db, user.id)}


def refresh(db: Session, refresh_token: str) -> dict[str, str]:
    try:
        payload = verify_refresh_token(refresh_token)
    except Exception as err:
        raise AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired") from err
    now = utcnow()
    result = db.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hash_token(refresh_token), RefreshToken.revoked_at.is_(None), RefreshToken.expires_at > now)
        .values(revoked_at=now)
    )
    db.commit()
    if result.rowcount != 1:  # type: ignore[attr-defined]
        raise AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired")
    return _issue_token_pair(db, payload["sub"])


def logout(db: Session, refresh_token: str) -> None:
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hash_token(refresh_token), RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    db.commit()
