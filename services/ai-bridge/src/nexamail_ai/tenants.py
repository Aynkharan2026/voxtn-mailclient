"""
Tenant provisioning + branding routes.

  POST /tenants            — create a tenant  (INTERNAL_SERVICE_TOKEN)
  GET  /tenants            — list all         (INTERNAL_SERVICE_TOKEN)
  GET  /tenants/{slug}     — get one config   (INTERNAL_SERVICE_TOKEN)
  PUT  /tenants/{slug}     — update branding  (INTERNAL_SERVICE_TOKEN)

apps/web hits GET /tenants/{slug} server-side from its own
/api/tenant/[slug]/config route, so we don't need to relax auth here.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .auth import require_internal_token
from .db import get_pool

PlanTier = Literal["free", "starter", "pro", "enterprise"]

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class Tenant(BaseModel):
    id: UUID
    slug: str
    name: str
    plan_tier: PlanTier
    clerk_org_id: str | None
    primary_color: str
    logo_url: str | None
    custom_domain: str | None
    imap_bridge_url: str
    ai_bridge_url: str
    crm_api_url: str | None
    crm_api_key_hint: str | None
    created_at: datetime
    updated_at: datetime


class TenantCreate(BaseModel):
    slug: str = Field(min_length=1, max_length=63)
    name: str = Field(min_length=1, max_length=200)
    plan_tier: PlanTier = "free"
    clerk_org_id: str | None = None
    primary_color: str | None = None
    logo_url: str | None = None
    custom_domain: str | None = None
    crm_api_url: str | None = None
    crm_api_key_hint: str | None = None


class TenantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    plan_tier: PlanTier | None = None
    clerk_org_id: str | None = None
    primary_color: str | None = None
    logo_url: str | None = None
    custom_domain: str | None = None
    crm_api_url: str | None = None
    crm_api_key_hint: str | None = None


router = APIRouter(
    prefix="/tenants", dependencies=[Depends(require_internal_token)]
)


def _row_to_tenant(row: asyncpg.Record) -> Tenant:
    return Tenant(
        id=row["id"],
        slug=row["slug"],
        name=row["name"],
        plan_tier=row["plan_tier"],
        clerk_org_id=row["clerk_org_id"],
        primary_color=row["primary_color"],
        logo_url=row["logo_url"],
        custom_domain=row["custom_domain"],
        imap_bridge_url=row["imap_bridge_url"],
        ai_bridge_url=row["ai_bridge_url"],
        crm_api_url=row["crm_api_url"],
        crm_api_key_hint=row["crm_api_key_hint"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _validate_color(c: str) -> None:
    if not HEX_COLOR_RE.match(c):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"primary_color '{c}' must be #RRGGBB hex",
        )


@router.post("", response_model=Tenant, status_code=status.HTTP_201_CREATED)
async def create_tenant(body: TenantCreate) -> Tenant:
    slug = body.slug.strip().lower()
    if not SLUG_RE.match(slug):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="slug must be lowercase alphanumerics + '-', max 63 chars, not starting with '-'",
        )
    if body.primary_color is not None:
        _validate_color(body.primary_color)

    pool = get_pool()
    try:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO tenants (
                    slug, name, plan_tier, clerk_org_id, primary_color,
                    logo_url, custom_domain, crm_api_url, crm_api_key_hint
                )
                VALUES ($1, $2, $3, $4,
                        COALESCE($5, '#f59e0b'),
                        $6, $7, $8, $9)
                RETURNING *
                """,
                slug,
                body.name,
                body.plan_tier,
                body.clerk_org_id,
                body.primary_color,
                body.logo_url,
                body.custom_domain,
                body.crm_api_url,
                body.crm_api_key_hint,
            )
    except asyncpg.UniqueViolationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"tenant slug '{slug}' already exists",
        ) from exc
    assert row is not None
    return _row_to_tenant(row)


@router.get("", response_model=list[Tenant])
async def list_tenants() -> list[Tenant]:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM tenants ORDER BY created_at ASC"
        )
    return [_row_to_tenant(r) for r in rows]


@router.get("/{slug}", response_model=Tenant)
async def get_tenant(slug: str) -> Tenant:
    s = slug.strip().lower()
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM tenants WHERE slug = $1", s)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"tenant '{s}' not found",
        )
    return _row_to_tenant(row)


@router.put("/{slug}", response_model=Tenant)
async def update_tenant(slug: str, body: TenantUpdate) -> Tenant:
    s = slug.strip().lower()
    if body.primary_color is not None:
        _validate_color(body.primary_color)

    fields: list[str] = []
    params: list[object] = []
    idx = 1

    for col, val in (
        ("name", body.name),
        ("plan_tier", body.plan_tier),
        ("clerk_org_id", body.clerk_org_id),
        ("primary_color", body.primary_color),
        ("logo_url", body.logo_url),
        ("custom_domain", body.custom_domain),
        ("crm_api_url", body.crm_api_url),
        ("crm_api_key_hint", body.crm_api_key_hint),
    ):
        if val is not None:
            fields.append(f"{col} = ${idx}")
            params.append(val)
            idx += 1

    if not fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="no fields to update",
        )

    fields.append("updated_at = now()")
    params.append(s)

    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            f"UPDATE tenants SET {', '.join(fields)} WHERE slug = ${idx} RETURNING *",
            *params,
        )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"tenant '{s}' not found",
        )
    return _row_to_tenant(row)
