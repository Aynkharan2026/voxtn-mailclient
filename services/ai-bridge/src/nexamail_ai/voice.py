"""
Voice → email pipeline.

Stages:
1. Audio upload                      (multipart/form-data, field `audio`)
2. Sarvam Saaras STT                 → transcript in the speaker's language
3. TamilTextProcessor (guarded)      → only if transcript contains Tamil code points
4. Gemini 2.0 Flash                  → { subject, html } as a polished email

All stages fail closed with clear HTTP errors. Secrets never leave memory.
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from .auth import require_internal_token
from .config import settings

logger = logging.getLogger(__name__)

# --- TamilTextProcessor import (bind-mounted from /opt/tamiltts-saas) --------
# Graceful fallback when the tamiltts-saas tree isn't mounted (local dev).
_TAMIL_SAAS_MOUNT = "/mnt/tamiltts-saas"
if _TAMIL_SAAS_MOUNT not in sys.path:
    sys.path.insert(0, _TAMIL_SAAS_MOUNT)
try:
    from app.services.tamil_text_processor import (  # type: ignore[import-not-found]
        process_text as _tamil_process,
    )
    _has_tamil_processor = True
    logger.info("TamilTextProcessor mounted from %s", _TAMIL_SAAS_MOUNT)
except Exception as exc:  # noqa: BLE001
    _has_tamil_processor = False
    logger.warning(
        "TamilTextProcessor not available (%s) — Tamil transcripts will pass through unchanged",
        exc,
    )

    def _tamil_process(text: str, source: str = "unknown") -> str:  # type: ignore[misc]
        return text


# --- Tamil detection ---------------------------------------------------------
# Tamil block is U+0B80..U+0BFF.
def _contains_tamil(text: str) -> bool:
    return any(0x0B80 <= ord(c) <= 0x0BFF for c in text)


# --- Stage functions ---------------------------------------------------------
SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"
GEMINI_MODEL = "gemini-2.0-flash"

PERSONA_PROMPT = """You are a professional email assistant. The user dictated a rough draft of an email via voice and it was transcribed automatically. Transcription errors are likely (homophones, missing punctuation, run-on sentences).

Your job: turn the transcript into a polished, professional email.

Rules:
- Keep the user's intent, tone, and every specific request / fact they mentioned. Do not invent facts.
- Fix transcription errors silently. Fix punctuation and casing.
- Produce a concise subject line (< 80 chars). If the transcript doesn't suggest one, summarise the main ask.
- Produce the body as well-formed HTML using <p>, <ul>, <li>, <br>, <strong>, <em> as appropriate.
- Do NOT add a greeting like "Hi X,".
- Do NOT add a signature — signatures are handled separately.
- If the transcript is in a language other than English, reply in that language.

Respond with JSON matching this schema exactly:
{ "subject": "string", "html": "string (HTML body only, no outer tags)" }"""


async def sarvam_stt(audio_bytes: bytes, content_type: str) -> str:
    if not settings.sarvam_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SARVAM_API_KEY not configured",
        )
    files = {"file": ("audio", audio_bytes, content_type)}
    data = {"model": "saaras:v2"}
    headers = {"api-subscription-key": settings.sarvam_api_key}
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(SARVAM_STT_URL, headers=headers, files=files, data=data)
    if r.status_code >= 400:
        logger.error("sarvam stt failed status=%s body=%s", r.status_code, r.text[:500])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"sarvam stt returned {r.status_code}",
        )
    payload: dict[str, Any] = r.json()
    transcript = (
        payload.get("transcript")
        or payload.get("transcript_text")
        or ""
    )
    if not transcript:
        logger.error("sarvam stt empty transcript: keys=%s", list(payload.keys()))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="sarvam stt returned empty transcript",
        )
    return transcript


def apply_tamil_processor_if_relevant(text: str) -> str:
    if not _contains_tamil(text):
        return text
    if not _has_tamil_processor:
        return text
    return _tamil_process(text, source="voxmail-voice-to-email")


class VoiceToEmailResponse(BaseModel):
    subject: str
    html: str


async def gemini_generate_email(transcript: str) -> VoiceToEmailResponse:
    if not settings.gemini_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GEMINI_API_KEY not configured",
        )
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent"
    )
    body = {
        "systemInstruction": {"parts": [{"text": PERSONA_PROMPT}]},
        "contents": [
            {"role": "user", "parts": [{"text": f"Voice transcript:\n\n{transcript}"}]}
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "subject": {"type": "STRING"},
                    "html": {"type": "STRING"},
                },
                "required": ["subject", "html"],
            },
            "temperature": 0.4,
        },
    }
    headers = {"x-goog-api-key": settings.gemini_api_key}
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(url, headers=headers, json=body)
    if r.status_code >= 400:
        logger.error("gemini failed status=%s body=%s", r.status_code, r.text[:500])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"gemini returned {r.status_code}",
        )
    payload: dict[str, Any] = r.json()
    candidates = payload.get("candidates") or []
    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="gemini returned no candidates",
        )
    try:
        text = candidates[0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        logger.error("gemini response not parseable: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="gemini response not parseable",
        ) from exc
    return VoiceToEmailResponse(
        subject=str(parsed.get("subject", "")).strip(),
        html=str(parsed.get("html", "")).strip(),
    )


# --- Router ------------------------------------------------------------------
router = APIRouter(dependencies=[Depends(require_internal_token)])

MAX_AUDIO_BYTES = 20 * 1024 * 1024  # 20 MB
MIN_AUDIO_BYTES = 1_000             # ~tenths of a second — smaller means bug


@router.post("/voice-to-email", response_model=VoiceToEmailResponse)
async def voice_to_email(
    audio: Annotated[UploadFile, File(description="Audio blob (webm/opus, mp3, wav, m4a)")],
) -> VoiceToEmailResponse:
    audio_bytes = await audio.read()
    size = len(audio_bytes)
    if size > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"audio too large: {size} bytes (max {MAX_AUDIO_BYTES})",
        )
    if size < MIN_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="audio too small — recording likely failed",
        )

    content_type = audio.content_type or "application/octet-stream"
    transcript = await sarvam_stt(audio_bytes, content_type)
    cleaned = apply_tamil_processor_if_relevant(transcript)
    return await gemini_generate_email(cleaned)
