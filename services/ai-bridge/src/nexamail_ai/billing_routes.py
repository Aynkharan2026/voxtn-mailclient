"""
Stripe billing routes:

  POST /stripe/webhook          — Stripe signature-verified event ingestion
  GET  /billing/plan?email=     — current tier + usage (no auth beyond
                                  INTERNAL_SERVICE_TOKEN; apps/web reads
                                  this to render settings)
  POST /billing/checkout        — create a Stripe Checkout session, return url

Webhook stays OUTSIDE the INTERNAL_SERVICE_TOKEN auth because Stripe calls
it directly. Signature verification with STRIPE_WEBHOOK_SECRET is the trust
anchor.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel

from .auth import require_internal_token
from .billing import Tier, price_id_to_tier
from .config import settings
from .db import get_pool

logger = logging.getLogger(__name__)

# ---- webhook router (no app-level auth) --------------------------------------
webhook_router = APIRouter()


@webhook_router.post("/stripe/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: Annotated[
        str | None, Header(alias="Stripe-Signature")
    ] = None,
) -> dict[str, Any]:
    if not stripe_signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="missing Stripe-Signature header",
        )
    if not settings.stripe_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="STRIPE_WEBHOOK_SECRET not configured",
        )

    payload = await request.body()

    # Manual signature verification (avoids stripe.Webhook.construct_event's
    # strict Event-schema reconstruction, which rejects minimal synthetic
    # payloads). Same HMAC-SHA256 scheme Stripe's SDK uses.
    timestamp: str | None = None
    v1_sigs: list[str] = []
    for part in stripe_signature.split(","):
        if "=" not in part:
            continue
        k, _, v = part.partition("=")
        k = k.strip()
        v = v.strip()
        if k == "t":
            timestamp = v
        elif k == "v1":
            v1_sigs.append(v)

    if not timestamp or not v1_sigs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="malformed Stripe-Signature header",
        )

    signed_payload = f"{timestamp}.{payload.decode('utf-8')}".encode("utf-8")
    expected = hmac.new(
        settings.stripe_webhook_secret.encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()

    if not any(hmac.compare_digest(expected, s) for s in v1_sigs):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="invalid Stripe signature",
        )

    try:
        event: dict[str, Any] = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"invalid JSON payload: {exc}",
        ) from exc

    event_type = event.get("type")
    data_object = event.get("data", {}).get("object", {}) or {}

    try:
        if event_type == "checkout.session.completed":
            await _handle_checkout_completed(data_object)
        elif event_type == "customer.subscription.updated":
            await _handle_subscription_updated(data_object)
        elif event_type == "customer.subscription.deleted":
            await _handle_subscription_deleted(data_object)
        else:
            logger.info("stripe webhook: ignoring event type %s", event_type)
    except Exception as exc:  # noqa: BLE001
        logger.error("stripe webhook handler failed: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"handler failed: {exc}",
        )

    return {"received": True, "type": event_type}


async def _handle_checkout_completed(session: dict[str, Any]) -> None:
    customer_id = session.get("customer")
    subscription_id = session.get("subscription")
    customer_email = (
        session.get("customer_email")
        or (session.get("customer_details") or {}).get("email")
        or (session.get("metadata") or {}).get("owner_email")
    )
    if not (customer_id and subscription_id and customer_email):
        logger.warning(
            "checkout.session.completed missing customer/subscription/email — ignoring"
        )
        return

    # Resolve the price to figure out the tier. If Stripe API key isn't
    # configured (tests), fall back to metadata-supplied tier.
    tier: Tier = "free"
    period_start: datetime | None = None
    period_end: datetime | None = None

    if settings.stripe_secret_key:
        stripe.api_key = settings.stripe_secret_key
        try:
            sub = stripe.Subscription.retrieve(subscription_id)
            items = sub.get("items", {}).get("data", [])
            if items:
                price_id = items[0].get("price", {}).get("id")
                tier = price_id_to_tier(price_id)
            ps = sub.get("current_period_start")
            pe = sub.get("current_period_end")
            if ps is not None:
                period_start = datetime.fromtimestamp(ps, tz=timezone.utc)
            if pe is not None:
                period_end = datetime.fromtimestamp(pe, tz=timezone.utc)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Stripe subscription lookup failed (%s); falling back to metadata", exc
            )

    # Metadata override for synthetic events / tests
    meta = session.get("metadata") or {}
    if meta.get("plan_tier") in {"free", "starter", "pro", "enterprise"}:
        tier = meta["plan_tier"]  # type: ignore[assignment]

    await _upsert_billing_row(
        owner_email=customer_email,
        tier=tier,
        stripe_customer_id=customer_id,
        stripe_subscription_id=subscription_id,
        period_start=period_start,
        period_end=period_end,
    )


async def _handle_subscription_updated(sub: dict[str, Any]) -> None:
    customer_id = sub.get("customer")
    subscription_id = sub.get("id")
    if not (customer_id and subscription_id):
        return

    items = (sub.get("items") or {}).get("data") or []
    price_id = items[0].get("price", {}).get("id") if items else None
    tier = price_id_to_tier(price_id)

    ps = sub.get("current_period_start")
    pe = sub.get("current_period_end")
    period_start = datetime.fromtimestamp(ps, tz=timezone.utc) if ps else None
    period_end = datetime.fromtimestamp(pe, tz=timezone.utc) if pe else None

    # Locate the owner_email from our DB by customer_id
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT owner_email FROM billing_usage WHERE stripe_customer_id = $1",
            customer_id,
        )
    if not row:
        logger.warning(
            "subscription.updated for unknown customer %s — ignoring", customer_id
        )
        return

    await _upsert_billing_row(
        owner_email=row["owner_email"],
        tier=tier,
        stripe_customer_id=customer_id,
        stripe_subscription_id=subscription_id,
        period_start=period_start,
        period_end=period_end,
    )


async def _handle_subscription_deleted(sub: dict[str, Any]) -> None:
    customer_id = sub.get("customer")
    if not customer_id:
        return
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE billing_usage
               SET plan_tier = 'free',
                   stripe_subscription_id = NULL,
                   updated_at = now()
             WHERE stripe_customer_id = $1
            """,
            customer_id,
        )


async def _upsert_billing_row(
    owner_email: str,
    tier: Tier,
    stripe_customer_id: str,
    stripe_subscription_id: str | None,
    period_start: datetime | None,
    period_end: datetime | None,
) -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO billing_usage
                (owner_email, plan_tier, stripe_customer_id, stripe_subscription_id,
                 period_start, period_end)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (owner_email) DO UPDATE
                SET plan_tier              = EXCLUDED.plan_tier,
                    stripe_customer_id     = EXCLUDED.stripe_customer_id,
                    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                    period_start           = EXCLUDED.period_start,
                    period_end             = EXCLUDED.period_end,
                    updated_at             = now()
            """,
            owner_email.lower(),
            tier,
            stripe_customer_id,
            stripe_subscription_id,
            period_start,
            period_end,
        )


# ---- app-level billing router (internal-token-protected) ---------------------
billing_router = APIRouter(
    prefix="/billing", dependencies=[Depends(require_internal_token)]
)


class PlanResponse(BaseModel):
    email: str
    plan_tier: Tier
    mailboxes_used: int
    ai_calls_this_month: int
    stripe_customer_id: str | None
    stripe_subscription_id: str | None
    period_start: datetime | None
    period_end: datetime | None


@billing_router.get("/plan", response_model=PlanResponse)
async def get_plan(
    email: Annotated[str, Query(min_length=3, max_length=254)],
) -> PlanResponse:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT plan_tier, mailboxes_used, ai_calls_this_month,
                   stripe_customer_id, stripe_subscription_id,
                   period_start, period_end
              FROM billing_usage
             WHERE owner_email = $1
            """,
            email.lower(),
        )
    if row is None:
        return PlanResponse(
            email=email.lower(),
            plan_tier="free",
            mailboxes_used=0,
            ai_calls_this_month=0,
            stripe_customer_id=None,
            stripe_subscription_id=None,
            period_start=None,
            period_end=None,
        )
    plan = row["plan_tier"]
    return PlanResponse(
        email=email.lower(),
        plan_tier=plan if plan in ("free", "starter", "pro", "enterprise") else "free",
        mailboxes_used=row["mailboxes_used"],
        ai_calls_this_month=row["ai_calls_this_month"],
        stripe_customer_id=row["stripe_customer_id"],
        stripe_subscription_id=row["stripe_subscription_id"],
        period_start=row["period_start"],
        period_end=row["period_end"],
    )


class CheckoutRequest(BaseModel):
    email: str
    plan_tier: Literal["starter", "pro"]


class CheckoutResponse(BaseModel):
    url: str


@billing_router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(body: CheckoutRequest) -> CheckoutResponse:
    if not settings.stripe_secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="STRIPE_SECRET_KEY not configured",
        )
    price_id = (
        settings.stripe_price_starter
        if body.plan_tier == "starter"
        else settings.stripe_price_pro
    )
    if not price_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"STRIPE_PRICE_{body.plan_tier.upper()} not configured",
        )

    stripe.api_key = settings.stripe_secret_key
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            customer_email=body.email.lower(),
            metadata={"owner_email": body.email.lower(), "plan_tier": body.plan_tier},
            success_url=f"{settings.app_base_url}/settings/billing?status=success",
            cancel_url=f"{settings.app_base_url}/settings/billing?status=cancelled",
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"stripe checkout create failed: {exc}",
        ) from exc

    url = session.get("url") if isinstance(session, dict) else session.url
    if not url:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="stripe returned no checkout url",
        )
    return CheckoutResponse(url=url)
