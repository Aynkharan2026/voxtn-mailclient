"""
Real-time Socket.io server — mounted under /socket.io/ on the FastAPI app.

Clients connect and call `subscribe` with a `message_id` to join a room.
When /track receives an event for that message_id, we emit `tracking_event`
to the room.

Auth: open for MVP — any TLS client can connect and subscribe. Tighten with
a handshake token in Phase 4.1 when we wire a session model.
"""

from __future__ import annotations

import logging
from typing import Any

import socketio

logger = logging.getLogger(__name__)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)


@sio.event
async def connect(sid: str, _environ: dict[str, Any]) -> None:
    logger.info("socketio connect sid=%s", sid)


@sio.event
async def disconnect(sid: str) -> None:
    logger.info("socketio disconnect sid=%s", sid)


@sio.event
async def subscribe(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    message_id = data.get("message_id")
    if not isinstance(message_id, str) or not message_id:
        return {"ok": False, "error": "message_id required"}
    await sio.enter_room(sid, f"message:{message_id}")
    return {"ok": True, "room": f"message:{message_id}"}


@sio.event
async def unsubscribe(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    message_id = data.get("message_id")
    if not isinstance(message_id, str) or not message_id:
        return {"ok": False, "error": "message_id required"}
    await sio.leave_room(sid, f"message:{message_id}")
    return {"ok": True}


async def emit_tracking_event(message_id: str, event: dict[str, Any]) -> None:
    """Emit a tracking event to everyone subscribed to this message_id."""
    await sio.emit("tracking_event", event, room=f"message:{message_id}")
