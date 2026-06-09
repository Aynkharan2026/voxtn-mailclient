"""Shared prompt-safety utilities for the VoxMail AI bridge.

Sovereign gateway (gateway.voxtn.com / local vLLM) — zero-retention, no third-party
training; content never leaves VoxTN infra.
"""


def frame_untrusted(text: str) -> str:
    """Wrap *text* in UNTRUSTED_CONTENT tags so the model treats it as data, not instructions.

    All three LLM call-sites (triage, draft, voice) MUST use this wrapper before
    placing incoming email body or voice transcript into a user message.
    """
    return f"<UNTRUSTED_CONTENT>\n{text}\n</UNTRUSTED_CONTENT>"
