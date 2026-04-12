# services/imap-bridge — IMAP/SMTP gateway

**Stack:** Node.js + TypeScript + [imapflow](https://imapflow.com/) + nodemailer
**Host:** Hetzner (Docker)
**Role:** Bridge between NexaMail and users' mail providers. Handles IMAP fetch/sync, folder ops, SMTP send, IDLE push.

## Responsibilities

- Connect to arbitrary IMAP/SMTP servers per-user (white-label — no fixed provider).
- Normalize messages into the shared schema from `@voxtn/shared`.
- Expose an internal HTTP/WebSocket API consumed by `apps/web` server routes.
- Manage per-connection lifecycle: auth, IDLE, reconnection, backoff.

## Conventions

- `imapflow` for IMAP, `nodemailer` for SMTP.
- Credentials in memory only; encrypted at rest in the user store, never logged.
- Structured logs (pino); redact mail bodies and credentials.
- All outbound network from this service — the web app must not talk IMAP directly.

## Do not

- Persist full message bodies beyond what sync requires; treat the user's mail server as the source of truth.
- Log tokens, passwords, OAuth refresh tokens, or raw message bodies.
- Hardcode provider-specific hosts — everything is configurable per user.

## Deploy

- Docker image, deployed to Hetzner via `infra/`.
- Internal service only — fronted by TLS + auth; not publicly routable.
