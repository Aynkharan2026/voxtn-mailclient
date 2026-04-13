import hmac
from typing import Annotated

from fastapi import Header, HTTPException, status

from .config import settings


def _check_bearer(authorization: str | None, expected: str, label: str) -> None:
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"service misconfigured: {label} not set",
        )
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
        )
    token = authorization.removeprefix("Bearer ")
    if not hmac.compare_digest(token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
        )


async def require_internal_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    _check_bearer(authorization, settings.internal_service_token, "INTERNAL_SERVICE_TOKEN")


async def require_tracking_worker_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    _check_bearer(authorization, settings.tracking_worker_token, "TRACKING_WORKER_TOKEN")
