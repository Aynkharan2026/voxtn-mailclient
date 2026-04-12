# NexaMail — VoxTN

**Product:** NexaMail — AI-powered white-label mail client
**Operator:** VoxTN (17488149 CANADA CORP)
**Repo:** voxtn-mailclient

## Identity

- Brand name: **NexaMail**
- Parent: **VoxTN**, a product brand of **17488149 CANADA CORP**
- Primary colors:
  - Navy: `#0d1b2e`
  - Amber: `#f59e0b`

## Repository layout

| Path | Purpose |
|---|---|
| `apps/web/` | Next.js 15 frontend (Vercel) |
| `services/imap-bridge/` | Node.js + imapflow IMAP/SMTP service (Hetzner) |
| `services/ai-bridge/` | FastAPI Python AI service (Hetzner) |
| `packages/shared/` | Shared TypeScript types, schemas, utilities |
| `packages/ui/` | Shared React UI components |
| `infra/` | Docker, compose, deploy scripts, IaC |
| `skills/` | Domain skill briefs for AI assistance |
| `docs/drift-audits/` | Drift protocol audit reports |

## Non-negotiables

- **No credentials in code. Ever.** No API keys, tokens, passwords, IMAP creds, or secrets committed to the repo. Use `.env` (gitignored) for local and secret stores in production.
- **Git identity:** commits in this repo use `aynkharan@gmail.com`.
- **Drift protocol:** periodic audits landed as dated reports in `docs/drift-audits/`. Scope creep, abandoned code paths, and mismatches between docs and implementation are flagged there.

## Working agreements

- TypeScript strict across web + shared + ui.
- Python typed (mypy/pyright) across ai-bridge.
- Prefer editing existing files; don't scaffold speculative structure.
- Each subtree has its own `CLAUDE.md` — read it before touching that tree.
