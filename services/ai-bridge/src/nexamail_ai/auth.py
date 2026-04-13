import hmac
from typing import Annotated

from fastapi import Header, HTTPException, status

from .config import settings


async def require_internal_token(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    if not settings.internal_service_token:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="service misconfigured: INTERNAL_SERVICE_TOKEN not set",
        )
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
        )
    token = authorization.removeprefix("Bearer ")
    if not hmac.compare_digest(token, settings.internal_service_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token",
        )
