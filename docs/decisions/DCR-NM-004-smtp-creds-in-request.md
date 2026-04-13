# DCR-NM-004 — SMTP credentials delivered per-request (MVP)

- **Status:** Accepted
- **Date:** 2026-04-12
- **Component:** `services/imap-bridge` (`POST /send`)
- **Supersedes:** —
- **Revisits in:** Phase 4 (account store)

## Context

VoxMail is a white-label client — each user connects to an arbitrary IMAP/SMTP mail server with their own credentials. There is no user / account model in the codebase yet: no database tables for accounts, no encrypted credentials store, no login flow.

We need to start sending mail now (Phase 3) so the composer has a usable round-trip. Blocking on the account store would push Phase 3 out by days.

## Decision

**For the MVP, every `POST /send` request carries SMTP credentials in the request body.** The imap-bridge service does **not** persist credentials.

Request shape (approximate — finalized when the endpoint is built):

```json
{
  "smtp": {
    "host": "smtp.example.com",
    "port": 465,
    "secure": true,
    "user": "alice@example.com",
    "pass": "<password or app-specific token>"
  },
  "message": {
    "from": "Alice <alice@example.com>",
    "to":   ["bob@example.com"],
    "cc":   [],
    "bcc":  [],
    "subject": "…",
    "html": "…"
  }
}
```

Transport:

- Caller (`apps/web` server actions, running on Vercel) holds the credentials in memory for the duration of the request only.
- Transport is `https://imap.nexamail.voxtn.com` — TLS end to end. The `INTERNAL_SERVICE_TOKEN` bearer is still required to reach imap-bridge.
- imap-bridge must never log `smtp.pass` (redact via pino config).
- No `.env` secret for SMTP on the imap-bridge side — callers bring their own.

## Alternatives considered

- **(b) Single dev SMTP account via env** — `DEV_SMTP_*` on imap-bridge. Simple, but not multi-tenant; every caller would send as the same mailbox. Rejected: VoxMail is white-label, one shared mailbox is useless.
- **(c) Build the account store now** — Postgres `accounts` table with encrypted `smtp_*` columns, `POST /accounts` endpoint, request uses `account_id`. This is the **correct long-term** design. Rejected for MVP because it pushes Phase 3 by ~1 day and we don't yet have a user/auth model to scope accounts against.

## Consequences

**Accepted costs:**

- `apps/web` must hold SMTP credentials somewhere temporarily. For the composer demo we'll keep them in a server-side form handler (never in client state); the real account store lands in Phase 4.
- Every `POST /send` request is slightly fatter (carries the creds).
- The imap-bridge must reject any credential leakage into logs/traces. Structured-log redaction is mandatory from day 1.

**Deferred work (Phase 4):**

- `accounts` table with encrypted `smtp_host/port/user/pass` columns.
- Key management: the encryption key must not be stored alongside the ciphertext. Likely a per-environment secret managed outside the DB.
- Replace `smtp` field in `POST /send` body with `account_id` (bearer still required).
- Migration path for any callers still sending raw creds.

**Non-goals:**

- No intent to keep raw-creds-in-body as a long-term pattern. This is explicitly a stopgap.
