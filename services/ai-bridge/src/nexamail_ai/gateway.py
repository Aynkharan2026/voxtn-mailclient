"""Shared sovereign gateway client for the VoxMail AI bridge.

gateway.voxtn.com / local vLLM — zero-retention, no third-party training;
content never leaves VoxTN infra.
"""

from __future__ import annotations

from typing import Any

import httpx

from .config import settings

# Gateway timeout (seconds)
_GATEWAY_TIMEOUT = 20.0

# Zero-retention / no-train headers — sent on every gateway request.
_NO_RETAIN_HEADERS: dict[str, str] = {
    "X-VoxTN-No-Retain": "1",
    "X-No-Train": "1",
}


async def _gateway_chat(model: str, messages: list[dict[str, str]]) -> str:
    """Call the sovereign gateway chat-completions endpoint and return the reply content."""
    url = settings.gateway_url.rstrip("/") + "/chat/completions"
    headers: dict[str, str] = {
        "Authorization": f"Bearer {settings.gateway_token}",
        "Content-Type": "application/json",
        **_NO_RETAIN_HEADERS,
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
