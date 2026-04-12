---
name: mail-imap
description: Implementing or modifying IMAP/SMTP behavior in services/imap-bridge — connection lifecycle, sync, folder ops, IDLE, send.
---

# Skill: mail-imap

Trigger when the task touches `services/imap-bridge` or any IMAP/SMTP behavior.

## Guardrails

- Use `imapflow` for IMAP; `nodemailer` for SMTP. Do not introduce a second IMAP library.
- Never log credentials or message bodies. Redact before `pino` emits.
- Treat the user's mail server as source of truth — the bridge is stateless beyond connection state and short-lived sync cursors.
- Provider-agnostic: no hardcoded hosts, ports, or quirks keyed to "gmail"/"outlook" outside a capabilities table.

## Typical work

- Per-user connection pool keyed by account id; reconnect with exponential backoff.
- IDLE for push; fall back to polling when the server rejects IDLE.
- UIDVALIDITY handling: invalidate local sync cursor on change.
- SMTP send with DKIM/SPF awareness (delegate signing to the user's server).

## Shared contracts

Message, Folder, Account schemas live in `packages/shared`. Update them there first, then on both sides.
