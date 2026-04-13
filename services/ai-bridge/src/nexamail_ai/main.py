from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncIterator

from fastapi import FastAPI
from pydantic import BaseModel

from .config import settings
from .crm import router as crm_router
from .db import close_pool, init_pool
from .signatures import router as signatures_router


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


app = FastAPI(title="VoxMail AI", version="0.1.0", lifespan=lifespan)
app.include_router(crm_router)
app.include_router(signatures_router)


class HealthResponse(BaseModel):
    service: str
    status: str
    time: str


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        service="voxmail-ai",
        status="ok",
        time=datetime.now(timezone.utc).isoformat(),
    )
