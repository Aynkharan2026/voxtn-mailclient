---
name: mail-crm
description: CRM integration surface — mapping mail threads and contacts into CRM records, syncing status back into the mail client.
---

# Skill: mail-crm

Trigger when the task involves contact enrichment, deal/lead association, or syncing CRM state into mail views.

## Guardrails

- CRM provider is pluggable — abstract behind a `CRMClient` interface; no HubSpot/Salesforce/etc. branching inside feature code.
- Contact, Deal, Activity schemas live in `packages/shared`.
- Never push full message bodies into a third-party CRM unless the user has explicitly opted in for that thread.

## Typical work

- Match a mail thread to an existing CRM contact/deal by email address + domain.
- Log thread summaries (from `mail-ai`) as CRM activities.
- Surface CRM context (deal stage, owner, last touch) in the thread sidebar.

## Dependencies

- Extraction comes from `mail-ai` (entities, action items).
- Calendar actions that emerge from CRM flow go through `mail-calendar`.
