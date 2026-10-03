from typing import Any

from fastapi import APIRouter

from app.deps import UserId
from app.jobs.sync import run_full_sync
from app.jsonenc import NodeRoute

router = APIRouter(route_class=NodeRoute)


@router.post("")
def sync(user_id: UserId) -> Any:
    return {"status": "ok", **run_full_sync()}
