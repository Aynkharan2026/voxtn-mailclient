from datetime import datetime
from ipaddress import ip_address
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from .auth import require_tracking_worker_token
from .db import get_pool
from .realtime import emit_tracking_event


class TrackRequest(BaseModel):
    message_id: str = Field(min_length=1, max_length=300)
    event_type: Literal["open", "click"]
    redirect_url: str | None = None
    user_agent: str | None = None
    ip: str | None = None


class TrackEvent(BaseModel):
    id: UUID
    message_id: str
    event_type: Literal["open", "click"]
    redirect_url: str | None = None
    user_agent: str | None = None
    ip: str | None = None
    created_at: datetime


router = APIRouter(
    prefix="/track",
    dependencies=[Depends(require_tracking_worker_token)],
    tags=["tracking"],
)


def _validate_ip(raw: str | None) -> str | None:
    if raw is None or raw == "":
        return None
    try:
        return str(ip_address(raw))
    except ValueError:
        return None


@router.post("", response_model=TrackEvent, status_code=status.HTTP_201_CREATED)
async def track_event(
    body: TrackRequest,
    x_forwarded_for: Annotated[str | None, Header(alias="X-Forwarded-For")] = None,
) -> TrackEvent:
    # Caller IP precedence: explicit body field > first X-Forwarded-For > none.
    ip = _validate_ip(body.ip) or _validate_ip(
        (x_forwarded_for or "").split(",")[0].strip() or None
    )

    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO tracking_events
                (message_id, event_type, redirect_url, user_agent, ip)
            VALUES ($1, $2, $3, $4, $5::inet)
            RETURNING id, message_id, event_type, redirect_url,
                      user_agent, host(ip) AS ip, created_at
            """,
            body.message_id,
            body.event_type,
            body.redirect_url,
            body.user_agent,
            ip,
        )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="insert returned no row",
        )

    event = TrackEvent(
        id=row["id"],
        message_id=row["message_id"],
        event_type=row["event_type"],
        redirect_url=row["redirect_url"],
        user_agent=row["user_agent"],
        ip=row["ip"],
        created_at=row["created_at"],
    )

    # Broadcast to Socket.io subscribers for this message_id.
    await emit_tracking_event(
        body.message_id,
        event.model_dump(mode="json"),
    )

    return event
