from datetime import datetime, timezone

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="NexaMail AI", version="0.1.0")


class HealthResponse(BaseModel):
    service: str
    status: str
    time: str


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        service="nexamail-ai",
        status="ok",
        time=datetime.now(timezone.utc).isoformat(),
    )
