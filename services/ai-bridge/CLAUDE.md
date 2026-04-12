# services/ai-bridge — AI service

**Stack:** Python 3.12+ + FastAPI + Pydantic + typed (pyright/mypy)
**Host:** Hetzner (Docker)
**Role:** AI feature backend — summarization, drafting, classification, smart replies, thread understanding, calendar/CRM extraction.

## Responsibilities

- Receive normalized mail payloads from `apps/web` (via server routes).
- Run LLM calls against the configured provider(s); abstract provider behind an interface so the model can change without touching callers.
- Return structured Pydantic responses matching the shared schemas in `@voxtn/shared`.

## Conventions

- FastAPI with async endpoints; Pydantic v2 models.
- Provider keys loaded from env at startup; never logged, never returned in responses.
- Every endpoint has a typed request and response model.
- Use prompt caching where the provider supports it.

## Do not

- Commit API keys, sample prompts with real customer data, or cached responses.
- Couple to a single LLM vendor — route through an internal `LLMClient` abstraction.
- Accept raw user input as system prompts.

## Deploy

- Docker image, deployed to Hetzner via `infra/`.
- Internal service only — authenticated calls from `apps/web` server routes.
