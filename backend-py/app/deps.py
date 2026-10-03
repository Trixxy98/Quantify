from typing import Annotated

import jwt
from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import AppError
from app.security import verify_access_token


def current_user_id(authorization: Annotated[str | None, Header()] = None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise AppError(401, "UNAUTHORIZED", "Token is required")
    try:
        payload = verify_access_token(authorization[len("Bearer ") :])
    except jwt.PyJWTError as err:
        raise AppError(401, "UNAUTHORIZED", "Invalid token") from err
    sub = payload.get("sub")
    if not isinstance(sub, str):
        raise AppError(401, "UNAUTHORIZED", "Invalid token")
    return sub


UserId = Annotated[str, Depends(current_user_id)]
Db = Annotated[Session, Depends(get_db)]
