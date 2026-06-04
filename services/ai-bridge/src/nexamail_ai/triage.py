import json
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth import require_internal_token
from .config import settings

# Gateway timeout (seconds)
_GATEWAY_TIMEOUT = 20.0

# Tamil Unicode block: U+0B80–U+0BFF
_TAMIL_LOW = 0x0B80
_TAMIL_HIGH = 0x0BFF

_SYSTEM_PROMPT = (
    "You are a strict email triage classifier. "
    "Analyse the email subject, body, and sender and return ONLY a JSON object with "
    "these exact keys and no other text:\n"
    '{"sentiment":"angry|neutral|positive","intent":"high|low","stop_request":true|false,'
    '"language":"english|tamil|other","summary":"<one line>"}\n'
    "Definitions:\n"
    "- sentiment angry: hostile, complaining, or abusive tone.\n"
    "- stop_request true: the sender asks to stop, unsubscribe, or be removed.\n"
    "- intent high: sender wants to buy, book, or take an urgent action.\n"
    "Return ONLY the JSON object — no markdown fences, no prose."
)


def detect_tamil(text: str) -> bool:
    """Return True if *text* contains at least one Tamil-script codepoint (U+0B80-U+0BFF)."""
    return any(_TAMIL_LOW <= ord(ch) <= _TAMIL_HIGH for ch in text)


async def _gateway_chat(model: str, messages: list[dict[str, str]]) -> str:
    """Call the sovereign gateway chat-completions endpoint and return the reply content."""
    url = settings.gateway_url.rstrip("/") + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {settings.gateway_token}",
        "Content-Type": "application/json",
    }
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0,
    }
    async with httpx.AsyncClient(timeout=_GATEWAY_TIMEOUT) as client:
        resp = await client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


async def classify(
    subject: str,
    body: str,
    from_email: str | None,
) -> dict[str, Any]:
    """Classify inbound email sentiment and intent via the sovereign gateway.

    Returns a dict with keys: sentiment, intent, stop_request, language, summary,
    priority, model_used.  On parse failure returns {"error":"parse","raw":<truncated>}.
    Raises HTTPException(503) if gateway_token is not configured.
    """
    if not settings.gateway_token:
        raise HTTPException(status_code=503, detail="gateway not configured")

    combined = (subject or "") + (body or "")
    model_alias = "llama-3.1-8b-local" if detect_tamil(combined) else "lfm2.5-8b"

    user_content = (
        f"From: {from_email or 'unknown'}\n"
        f"Subject: {subject or ''}\n\n"
        f"{body or ''}"
    )
    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    raw_content = await _gateway_chat(model_alias, messages)

    # Robust JSON extraction: strip markdown fences if present
    clean = raw_content.strip()
    if clean.startswith("```"):
        lines = clean.splitlines()
        # drop first fence line and last fence line
        inner_lines = []
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
        result: dict[str, Any] = json.loads(clean)
    except json.JSONDecodeError:
        return {"error": "parse", "raw": raw_content[:500]}

    sentiment = result.get("sentiment", "neutral")
    stop_request = bool(result.get("stop_request", False))
    intent = result.get("intent", "low")

    if sentiment == "angry" or stop_request:
        priority = "red"
    elif intent == "high":
        priority = "gold"
    else:
        priority = "normal"

    return {
        "sentiment": sentiment,
        "intent": intent,
        "stop_request": stop_request,
        "language": result.get("language", "other"),
        "summary": result.get("summary", ""),
        "priority": priority,
        "model_used": model_alias,
    }


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

triage_router = APIRouter(
    prefix="/triage",
    dependencies=[Depends(require_internal_token)],
)


class TriageRequest(BaseModel):
    subject: str | None = None
    body: str
    from_email: str | None = None
    message_id: str | None = None


@triage_router.post("")
async def triage_message(req: TriageRequest) -> dict[str, Any]:
    return await classify(
        subject=req.subject or "",
        body=req.body,
        from_email=req.from_email,
    )
