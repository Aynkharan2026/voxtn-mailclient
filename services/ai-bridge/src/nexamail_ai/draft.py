"""Autonomous reply-draft generator (human-approve-before-send).

Given an inbound message, generates a suggested reply draft via the sovereign
gateway.  It NEVER sends — it returns a draft marked requires_approval: True
for a human (or a governed agent) to approve.

English agent reasoning  → lfm2.5-8b
Tamil prose              → llama-3.1-8b-local  (benchmarked Tamil writer)
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import require_internal_token
from .config import settings
from .triage import _gateway_chat, detect_tamil

logger = logging.getLogger(__name__)

_DRAFT_SYSTEM_PROMPT = (
    "You draft a professional, concise reply to the inbound email below for HUMAN REVIEW. "
    "Do NOT fabricate facts, prices, or commitments — if specifics are unknown, use a "
    "neutral placeholder and flag it. "
    'Return STRICT JSON: {"draft_subject": "...", "draft_body": "..."}'
)


async def draft_reply(
    subject: str,
    body: str,
    from_email: str | None,
    triage_hint: str | None = None,
) -> dict[str, Any]:
    """Generate a suggested reply draft via the sovereign gateway.

    Returns a dict with keys: draft_subject, draft_body, language, model_used,
    requires_approval (always True).
    On parse failure returns {"error": "parse", "raw": <first 500 chars>}.
    Raises HTTPException(503) if gateway_token is not configured.
    """
    if not settings.gateway_token:
        raise HTTPException(status_code=503, detail="gateway not configured")

    combined = (subject or "") + (body or "")
    is_tamil = detect_tamil(combined)
    model_alias = "llama-3.1-8b-local" if is_tamil else "lfm2.5-8b"
    language = "tamil" if is_tamil else "english"

    user_parts = [
        f"From: {from_email or 'unknown'}",
        f"Subject: {subject or ''}",
        "",
        body or "",
    ]
    if triage_hint:
        user_parts.insert(0, f"[Triage hint: {triage_hint}]")
        user_parts.insert(1, "")

    user_content = "\n".join(user_parts)

    messages = [
        {"role": "system", "content": _DRAFT_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    raw_content = await _gateway_chat(model_alias, messages)

    # Robust JSON extraction: strip markdown fences if present
    clean = raw_content.strip()
    if clean.startswith("```"):
        lines = clean.splitlines()
        inner_lines: list[str] = []
        in_block = False
        for line in lines:
            if line.startswith("```") and not in_block:
                in_block = True
                continue
            if line.startswith("```") and in_block:
                break
            if in_block:
                inner_lines.append(line)
        clean = "\n".join(inner_lines).strip()

    try:
        parsed: dict[str, Any] = json.loads(clean)
    except json.JSONDecodeError:
        logger.warning("draft_reply parse failure: raw=%r", raw_content[:200])
        return {"error": "parse", "raw": raw_content[:500]}

    return {
        "draft_subject": str(parsed.get("draft_subject", "")),
        "draft_body": str(parsed.get("draft_body", "")),
        "language": language,
        "model_used": model_alias,
        "requires_approval": True,
    }


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

draft_router = APIRouter(
    prefix="/draft",
    dependencies=[Depends(require_internal_token)],
)


class DraftRequest(BaseModel):
    subject: str | None = None
    body: str
    from_email: str | None = None
    triage_hint: str | None = None


@draft_router.post("")
async def draft_message(req: DraftRequest) -> dict[str, Any]:
    return await draft_reply(
        subject=req.subject or "",
        body=req.body,
        from_email=req.from_email,
        triage_hint=req.triage_hint,
    )
