from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel

from .crm import router as crm_router

app = FastAPI(title="VoxMail AI", version="0.1.0")
app.include_router(crm_router)


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
