import re
from typing import Any

from fastapi import APIRouter, Body, Response
from pydantic import BaseModel, field_validator

from app.deps import Db
from app.jsonenc import NodeRoute
from app.services import auth as auth_service
from app.validation import parse_body

router = APIRouter(route_class=NodeRoute)

# Close to zod's email check, so the same inputs pass and fail.
EMAIL = re.compile(r"^(?!\.)(?!.*\.\.)[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+\-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$")


def _email(value: str) -> str:
    if not EMAIL.match(value):
        raise ValueError("Invalid email address")
    return value


def _non_empty(value: str, message: str) -> str:
    if len(value) < 1:
        raise ValueError(message)
    return value


class RegisterBody(BaseModel):
    email: str
    password: str
    name: str

    @field_validator("email")
    @classmethod
    def _check_email(cls, value: str) -> str:
        return _email(value)

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("Password must be at least 8 characters long")
        return value

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return _non_empty(value, "Name is required")


class LoginBody(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _check_email(cls, value: str) -> str:
        return _email(value)

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        return _non_empty(value, "Password is required")


class TokenBody(BaseModel):
    refreshToken: str

    @field_validator("refreshToken")
    @classmethod
    def _check_token(cls, value: str) -> str:
        return _non_empty(value, "Refresh token is required")


@router.post("/register", status_code=201)
def register(db: Db, payload: Any = Body(None)) -> dict:
    body = parse_body(RegisterBody, payload)
    return auth_service.register(db, body.email, body.password, body.name)


@router.post("/login")
def login(db: Db, payload: Any = Body(None)) -> dict:
    body = parse_body(LoginBody, payload)
    return auth_service.login(db, body.email, body.password)


@router.post("/refresh")
def refresh(db: Db, payload: Any = Body(None)) -> dict:
    body = parse_body(TokenBody, payload)
    return auth_service.refresh(db, body.refreshToken)


@router.post("/logout", status_code=204)
def logout(db: Db, payload: Any = Body(None)) -> Response:
    body = parse_body(TokenBody, payload)
    auth_service.logout(db, body.refreshToken)
    return Response(status_code=204)
