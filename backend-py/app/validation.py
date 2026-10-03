"""Request validation with zod's error envelope: `{code: VALIDATION_ERROR, message: "Invalid input", details: fieldErrors}`."""

from typing import Any

from pydantic import BaseModel, ValidationError

from app.errors import AppError


def field_errors(err: ValidationError) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for issue in err.errors():
        location = [str(part) for part in issue.get("loc", ())]
        key = location[0] if location else "_"
        message = str(issue.get("msg", "Invalid"))
        message = message.removeprefix("Value error, ")
        if issue.get("type") == "missing":
            message = "Required"
        out.setdefault(key, []).append(message)
    return out


def parse_body[M: BaseModel](model: type[M], payload: Any) -> M:
    try:
        return model.model_validate(payload if payload is not None else {})
    except ValidationError as err:
        raise AppError(400, "VALIDATION_ERROR", "Invalid input", field_errors(err)) from err


def parse_query[M: BaseModel](model: type[M], params: dict[str, Any], message: str) -> M:
    """Query parsing where the Node handler threw its own message instead of the generic one."""
    try:
        return model.model_validate(params)
    except ValidationError as err:
        raise AppError(400, "VALIDATION_ERROR", message) from err
