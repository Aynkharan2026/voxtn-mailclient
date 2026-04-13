"""
Billing / feature-gate helpers.

The gate is **opt-in** — callers that don't send the X-Voxmail-User
header are allowed through (legacy / internal path). Callers that do
identify themselves are enforced against their billing_usage row.

Tier matrix:
  free        — no AI features
  starter     — summaries + CRM context (Phase 2/4 features)
  pro         — everything (voice, CRM, campaigns, summaries)
  enterprise  — everything (manual billing outside Stripe)
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import Header, HTTPException, status

from .config import settings
from .db import get_pool

Tier = Literal["free", "starter", "pro", "enterprise"]
Feature = Literal["voice", "campaigns", "crm", "summaries"]

PLAN_FEATURES: dict[Tier, set[Feature]] = {
    "free": set(),
    "starter": {"summaries", "crm"},
    "pro": {"voice", "campaigns", "crm", "summaries"},
    "enterprise": {"voice", "campaigns", "crm", "summaries"},
}


def price_id_to_tier(price_id: str | None) -> Tier:
    if not price_id:
        return "free"
    if price_id == settings.stripe_price_starter:
        return "starter"
    if price_id == settings.stripe_price_pro:
        return "pro"
    return "free"


async def get_plan_for_email(email: str) -> Tier:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT plan_tier FROM billing_usage WHERE owner_email = $1",
            email.lower(),
        )
    if row is None:
        return "free"
    plan = row["plan_tier"]
    if plan in ("free", "starter", "pro", "enterprise"):
        return plan  # type: ignore[return-value]
    return "free"


async def enforce_feature(
    feature: Feature,
    x_voxmail_user: str | None,
) -> None:
    """Raises 402 if the caller identified via X-Voxmail-User doesn't have
    the feature on their plan. No-op if the header is absent."""
    if not x_voxmail_user:
        return
    email = x_voxmail_user.strip().lower()
    if not email:
        return
    plan = await get_plan_for_email(email)
    if feature not in PLAN_FEATURES.get(plan, set()):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"feature '{feature}' not available on plan '{plan}'. "
                "Upgrade at /settings/billing."
            ),
        )


def require_voice_feature(
    x_voxmail_user: Annotated[str | None, Header(alias="X-Voxmail-User")] = None,
):
    """FastAPI dependency factory for the /voice-to-email route."""
    async def _check() -> None:
        await enforce_feature("voice", x_voxmail_user)
    return _check


async def voice_gate(
    x_voxmail_user: Annotated[str | None, Header(alias="X-Voxmail-User")] = None,
) -> None:
    await enforce_feature("voice", x_voxmail_user)


async def crm_gate(
    x_voxmail_user: Annotated[str | None, Header(alias="X-Voxmail-User")] = None,
) -> None:
    await enforce_feature("crm", x_voxmail_user)
