from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from .auth import require_internal_token
from .db import get_pool


class Signature(BaseModel):
    id: UUID
    owner_email: str
    name: str
    html_content: str
    is_default: bool
    created_at: datetime
    updated_at: datetime


class SignatureCreate(BaseModel):
    owner_email: str = Field(min_length=3, max_length=254)
    name: str = Field(min_length=1, max_length=120)
    html_content: str = Field(min_length=1)
    is_default: bool = False


class SignatureUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    html_content: str | None = Field(default=None, min_length=1)
    is_default: bool | None = None


router = APIRouter(
    prefix="/signatures",
    dependencies=[Depends(require_internal_token)],
    tags=["signatures"],
)


def _to_signature(row: asyncpg.Record) -> Signature:
    return Signature(
        id=row["id"],
        owner_email=row["owner_email"],
        name=row["name"],
        html_content=row["html_content"],
        is_default=row["is_default"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


@router.get("", response_model=list[Signature])
async def list_signatures(
    email: Annotated[str, Query(min_length=3, max_length=254)],
) -> list[Signature]:
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, owner_email, name, html_content, is_default,
                   created_at, updated_at
              FROM signatures
             WHERE owner_email = $1
             ORDER BY is_default DESC, created_at ASC
            """,
            email,
        )
    return [_to_signature(r) for r in rows]


@router.post("", response_model=Signature, status_code=status.HTTP_201_CREATED)
async def create_signature(body: SignatureCreate) -> Signature:
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            if body.is_default:
                await conn.execute(
                    """
                    UPDATE signatures
                       SET is_default = false, updated_at = now()
                     WHERE owner_email = $1 AND is_default = true
                    """,
                    body.owner_email,
                )
            try:
                row = await conn.fetchrow(
                    """
                    INSERT INTO signatures (owner_email, name, html_content, is_default)
                    VALUES ($1, $2, $3, $4)
                    RETURNING id, owner_email, name, html_content, is_default,
                              created_at, updated_at
                    """,
                    body.owner_email,
                    body.name,
                    body.html_content,
                    body.is_default,
                )
            except asyncpg.UniqueViolationError as exc:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="default signature already exists for owner",
                ) from exc
    assert row is not None
    return _to_signature(row)


@router.put("/{sig_id}", response_model=Signature)
async def update_signature(sig_id: UUID, body: SignatureUpdate) -> Signature:
    fields: list[str] = []
    params: list[Any] = []
    idx = 1
    if body.name is not None:
        fields.append(f"name = ${idx}")
        params.append(body.name)
        idx += 1
    if body.html_content is not None:
        fields.append(f"html_content = ${idx}")
        params.append(body.html_content)
        idx += 1
    if body.is_default is not None:
        fields.append(f"is_default = ${idx}")
        params.append(body.is_default)
        idx += 1

    if not fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="no fields to update",
        )

    fields.append("updated_at = now()")
    params.append(sig_id)

    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            if body.is_default is True:
                owner = await conn.fetchval(
                    "SELECT owner_email FROM signatures WHERE id = $1",
                    sig_id,
                )
                if owner is None:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="signature not found",
                    )
                await conn.execute(
                    """
                    UPDATE signatures
                       SET is_default = false, updated_at = now()
                     WHERE owner_email = $1 AND is_default = true AND id <> $2
                    """,
                    owner,
                    sig_id,
                )
            try:
                row = await conn.fetchrow(
                    f"""
                    UPDATE signatures SET {', '.join(fields)}
                     WHERE id = ${idx}
                 RETURNING id, owner_email, name, html_content, is_default,
                           created_at, updated_at
                    """,
                    *params,
                )
            except asyncpg.UniqueViolationError as exc:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="default signature already exists for owner",
                ) from exc
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="signature not found",
        )
    return _to_signature(row)


@router.delete("/{sig_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_signature(sig_id: UUID) -> Response:
    pool = get_pool()
    async with pool.acquire() as conn:
        result = await conn.execute("DELETE FROM signatures WHERE id = $1", sig_id)
    if result == "DELETE 0":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="signature not found",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{sig_id}/set-default", response_model=Signature)
async def set_default_signature(sig_id: UUID) -> Signature:
    pool = get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT owner_email FROM signatures WHERE id = $1",
                sig_id,
            )
            if row is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="signature not found",
                )
            owner = row["owner_email"]
            await conn.execute(
                """
                UPDATE signatures
                   SET is_default = false, updated_at = now()
                 WHERE owner_email = $1 AND is_default = true AND id <> $2
                """,
                owner,
                sig_id,
            )
            updated = await conn.fetchrow(
                """
                UPDATE signatures
                   SET is_default = true, updated_at = now()
                 WHERE id = $1
             RETURNING id, owner_email, name, html_content, is_default,
                       created_at, updated_at
                """,
                sig_id,
            )
    assert updated is not None
    return _to_signature(updated)
