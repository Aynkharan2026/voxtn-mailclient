---
name: mail-calendar
description: Calendar integration — detecting scheduling intent in mail, proposing times, creating events, handling invites (iCal/ICS).
---

# Skill: mail-calendar

Trigger when the task involves scheduling, meeting detection, ICS parsing, or calendar provider integration.

## Guardrails

- Calendar provider is pluggable — abstract behind a `CalendarClient` interface (Google, Microsoft 365, CalDAV, ICS-only fallback).
- ICS is the interchange format. Parse/emit RFC 5545 faithfully; don't invent fields.
- Time zones: store UTC + user tz; never render a time without an explicit tz.

## Typical work

- Detect scheduling intent in an inbound thread (via `mail-ai`) and offer time suggestions.
- Accept/decline invite flows writing back to the user's calendar.
- Free/busy lookup for suggest-a-time.

## Dependencies

- Intent extraction and time-phrase parsing come from `mail-ai`.
- Event participants often resolve through `mail-crm` for context.
