# NexaMail

**AI-powered white-label mail client.** A [VoxTN](https://voxtn.example) product, operated by 17488149 CANADA CORP.

NexaMail connects to any IMAP/SMTP mail server and layers AI-assisted triage, summarization, drafting, and scheduling on top — without locking users to a specific provider.

## Monorepo layout

```
apps/
  web/                  Next.js 15 frontend (Vercel)
services/
  imap-bridge/          Node.js + imapflow IMAP/SMTP gateway (Hetzner)
  ai-bridge/            FastAPI Python AI service (Hetzner)
packages/
  shared/               Shared TS types, schemas, utilities
  ui/                   Shared React UI components
infra/                  Docker, compose, deploy scripts
skills/                 Domain skill briefs
docs/
  drift-audits/         Periodic drift protocol audit reports
```

Each subtree has its own `CLAUDE.md` with conventions specific to that tree. Read it before making changes there.

## Brand

- **Navy:** `#0d1b2e`
- **Amber:** `#f59e0b`

## Getting started

```bash
git clone https://github.com/Aynkharan2026/voxtn-mailclient.git
cd voxtn-mailclient
cp .env.example .env
```

Per-package install instructions land as each app is scaffolded.

## Rules

- **No credentials in code, ever.** Use `.env` locally (gitignored) and managed secrets in production.
- Drift audits go in `docs/drift-audits/` with a dated filename.

## License

Proprietary — © 17488149 CANADA CORP.
