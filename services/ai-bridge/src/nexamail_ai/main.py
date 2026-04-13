from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncIterator

import socketio
from fastapi import FastAPI
from pydantic import BaseModel

from .config import settings
from .crm import router as crm_router
from .db import close_pool, init_pool
from .realtime import sio
from .signatures import router as signatures_router
from .tracking import router as tracking_router
from .voice import router as voice_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    if not settings.database_url:
        raise RuntimeError(
            "DATABASE_URL is not set — voxmail-ai cannot start without a Postgres DSN"
        )
    await init_pool(settings.database_url)
    try:
        yield
    finally:
        await close_pool()


fastapi_app = FastAPI(title="VoxMail AI", version="0.1.0", lifespan=lifespan)
fastapi_app.include_router(crm_router)
fastapi_app.include_router(signatures_router)
fastapi_app.include_router(voice_router)
fastapi_app.include_router(tracking_router)


class HealthResponse(BaseModel):
    service: str
    status: str
    time: str


@fastapi_app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        service="voxmail-ai",
        status="ok",
        time=datetime.now(timezone.utc).isoformat(),
    )


# Wrap the FastAPI app with the Socket.io ASGI app so /socket.io/* is
# served by python-socketio and everything else passes through to FastAPI.
# This `app` is what uvicorn binds to.
app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="socket.io")
