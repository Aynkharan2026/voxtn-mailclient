---
name: mail-compliance
description: Privacy, retention, audit, and regulatory concerns — PIPEDA/GDPR, data residency, deletion, export, logging hygiene.
---

# Skill: mail-compliance

Trigger when the task touches data retention, user data export/deletion, logging of personal data, audit trails, or regional data handling.

## Guardrails

- **Operator:** VoxTN (17488149 CANADA CORP) — Canadian entity. Default jurisdiction for compliance posture is **PIPEDA**; GDPR applies for EU users.
- Mail bodies, attachments, and contact data are **personal information**. Minimize retention; the user's mail server is the source of truth.
- Logs: never persist message bodies, credentials, tokens, or full email addresses at info level. Redact.
- User data export: a user must be able to export their data (accounts, settings, generated drafts) in a portable format.
- User data deletion: deletion requests must remove rows + purge caches within the documented SLA.

## Typical work

- Retention policy enforcement (TTL on caches, summaries, AI outputs).
- Export endpoint producing a zipped JSON bundle.
- Delete-my-account flow: cascade through `services/*` and any downstream integrations.
- Audit log of privileged operations (admin views, support impersonation if ever added).

## Do not

- Ship features that silently store message content in third-party services.
- Add analytics that capture message content, subjects, or recipient lists.
