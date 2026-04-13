from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from .auth import require_internal_token


class Contact(BaseModel):
    id: str
    email: str
    name: str
    company: str | None = None


class Stage(BaseModel):
    deal_id: str
    stage: str
    owner: str
    amount: float | None = None


class Activity(BaseModel):
    type: str
    occurred_at: datetime
    summary: str


class CRMContext(BaseModel):
    contact: Contact
    stage: Stage | None
    activities: list[Activity]


# Mock data. Will be replaced by calls to the VoxTN Platform API (port 8011)
# once /contacts, /deals, /activities routes are added there. Keep mock
# entries thin — enough to exercise the three shapes (full, no-deal, missing).
_MOCK: dict[str, CRMContext] = {
    "alice@example.com": CRMContext(
        contact=Contact(
            id="c_001",
            email="alice@example.com",
            name="Alice Johnson",
            company="Acme Inc",
        ),
        stage=Stage(
            deal_id="d_100",
            stage="Qualified",
            owner="bob@voxtn.com",
            amount=25000.0,
        ),
        activities=[
            Activity(
                type="email",
                occurred_at=datetime(2026, 4, 10, 14, 3, tzinfo=timezone.utc),
                summary="Reply on pricing",
            ),
            Activity(
                type="call",
                occurred_at=datetime(2026, 4, 8, 16, 30, tzinfo=timezone.utc),
                summary="Discovery call with CTO",
            ),
            Activity(
                type="note",
                occurred_at=datetime(2026, 4, 7, 9, 0, tzinfo=timezone.utc),
                summary="Needs proposal by month end",
            ),
        ],
    ),
    "nodeal@example.com": CRMContext(
        contact=Contact(
            id="c_002",
            email="nodeal@example.com",
            name="Charlie Casual",
        ),
        stage=None,
        activities=[],
    ),
}


router = APIRouter(prefix="/crm", dependencies=[Depends(require_internal_token)])


@router.get("/context", response_model=CRMContext)
async def get_crm_context(
    email: Annotated[str, Query(min_length=3, max_length=254)],
) -> CRMContext:
    key = email.lower().strip()
    if key not in _MOCK:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"no CRM contact for {email}",
        )
    return _MOCK[key]
