# DCR-NM-008 — Cal.com `ALLOWED_HOSTNAMES` must live in compose `environment:`, not `env_file`

- **Status:** Accepted
- **Date:** 2026-04-13
- **Component:** `/opt/calcom/docker-compose.yml` (and any future compose service whose env values contain literal quote characters)
- **Discovered during:** Phase 4 Cal.com install

## Context

Cal.com v6 reads the `ALLOWED_HOSTNAMES` environment variable and passes it through `JSON.parse()` during middleware boot. The expected value is a JSON-encoded array of hostnames, e.g.:

```
ALLOWED_HOSTNAMES=["cal.voxtn.com"]
```

When this string is placed in a `.env` file referenced by a compose service's `env_file:` directive, **docker-compose strips the inner double quotes** while loading. The value inside the container becomes:

```
[cal.voxtn.com]
```

which is not valid JSON (`cal.voxtn.com` is an unquoted identifier inside the array). Cal.com's middleware crashes on first request with:

```
⨯ unhandledRejection:  SyntaxError: Unexpected token 'c', "[cal.voxtn.com]" is not valid JSON
    at JSON.parse (<anonymous>)
    at Object.<anonymous> (.next/server/middleware.js:4:3)
```

Every request then returns HTTP 500 and the app is functionally dead even though the container stays "healthy" by Docker's TCP healthcheck.

## Decision

**Set `ALLOWED_HOSTNAMES` (and any other env var whose value contains literal `"` characters) in the compose `environment:` block, not in `env_file`.** YAML string parsing preserves the value verbatim.

```yaml
services:
  calcom:
    env_file:
      - .env
    environment:
      - TZ=America/Toronto
      - ALLOWED_HOSTNAMES=["cal.voxtn.com"]
```

Inside the container:

```
$ printenv ALLOWED_HOSTNAMES
["cal.voxtn.com"]
```

Cal.com boots, `JSON.parse` succeeds, middleware works.

## Alternatives considered

- **Escape the inner quotes in `.env`**: `ALLOWED_HOSTNAMES=[\"cal.voxtn.com\"]`. Works in some docker-compose versions; behavior differs across v1 (python) and v2 (go) implementations and is not portable. Rejected.
- **Single-quote wrap the value**: `ALLOWED_HOSTNAMES='["cal.voxtn.com"]'`. Docker-compose's env_file spec is ambiguous on whether single quotes are literal or stripped; behavior varies. Rejected.
- **Ship a pre-rendered `.env` from an external tool (direnv / envsubst)** so the values arrive already escaped. Adds toolchain coupling for a single variable. Rejected.
- **Patch Cal.com to accept a comma-separated list** as a fallback to JSON. Out of scope; we don't fork Cal.com.

The compose `environment:` block is idiomatic for values that carry literal quote characters, and this is the first of what will likely be several such cases as we integrate more third-party services.

## Consequences

- **Rule for future compose files:** any env var whose value starts with `[`, `{`, or contains literal `"` goes in `environment:`, not in `env_file`. Secrets stay in `env_file` since they're simple strings. Mixing the two is the intended pattern.
- **Applies beyond Cal.com:** we've already seen this pattern in other projects (e.g. `CORS_ORIGINS='["https://a.com","https://b.com"]'` in Next.js apps). Treat this DCR as general guidance, not Cal.com-specific.
- **Debuggability:** the failure mode is confusing — the container reports healthy (TCP listens), but every request 500s. First symptom in logs is `JSON.parse` throwing with the stripped-quote string in the error message, which is a reliable fingerprint. Grep for `"not valid JSON"` on any new compose deploy that uses bracketed env values.
- **No impact on existing services in this repo.** `voxmail-imap` and `voxmail-ai` don't pass any bracketed/quoted env values.

## References

- Docker Compose env_file parsing: https://docs.docker.com/reference/compose-file/services/#env_file — notes that quotes are "interpreted" in v2, which is the trap.
- Cal.com `ALLOWED_HOSTNAMES` source (v6): `packages/lib/orgDomains.ts` — `JSON.parse(process.env.ALLOWED_HOSTNAMES ?? "[]")`.
