---
name: mail-ai
description: Implementing AI features in services/ai-bridge — summarization, drafting, classification, extraction, smart replies.
---

# Skill: mail-ai

Trigger when the task touches `services/ai-bridge` or adds an AI feature in `apps/web` that calls it.

## Guardrails

- All LLM calls go through the internal `LLMClient` abstraction — no direct provider SDK calls from endpoints.
- Typed Pydantic request + response for every endpoint. No untyped `dict` in / out.
- Never echo API keys or provider error payloads (which may contain keys) to callers.
- Prompt injection: user-supplied text is *data*, never a system instruction. Wrap and label it in prompts.

## Typical work

- Thread summarization, draft reply generation, priority classification, action-item extraction.
- Calendar/CRM entity extraction feeding `mail-calendar` and `mail-crm` flows.
- Prompt caching for repeated system prompts / large contexts.

## Shared contracts

Request/response schemas live in `packages/shared` and mirror Pydantic models in `services/ai-bridge`. Keep them in lockstep.
