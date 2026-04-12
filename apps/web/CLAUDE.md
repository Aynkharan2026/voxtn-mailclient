# apps/web — NexaMail frontend

**Stack:** Next.js 15 (App Router) + React + TypeScript + Tailwind
**Host:** Vercel
**Role:** User-facing mail client UI — inbox, threading, composer, settings, AI actions.

## Conventions

- Next.js 15 with the **App Router** only (`app/`), no `pages/`.
- React Server Components by default; `"use client"` only where needed (inputs, local state, event handlers).
- Styling: Tailwind with brand tokens — navy `#0d1b2e`, amber `#f59e0b`.
- Shared types from `@voxtn/shared`; shared components from `@voxtn/ui`.
- Data fetching: server actions / route handlers that proxy to `services/imap-bridge` and `services/ai-bridge`.
- Auth session and user identity belong on the server; never expose service tokens to the browser.

## Do not

- Embed IMAP/SMTP credentials or AI provider keys in client bundles.
- Call `services/*` directly from client components — always go through a server route.
- Fork shared UI components locally — contribute upstream to `packages/ui`.

## Deploy

- Vercel project bound to this subtree via monorepo settings.
- Environment variables managed in Vercel dashboard; mirror keys in root `.env.example`.
