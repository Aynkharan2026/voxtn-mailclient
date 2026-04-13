# DCR-NM-003 — Container networking on the shared host

- **Status:** Accepted
- **Date:** 2026-04-12
- **Component:** `infra/docker-compose.yml`, `services/imap-bridge`, `services/ai-bridge`

## Context

VoxMail services (`imap-bridge`, `ai-bridge`) are containerized and deployed to the shared Hetzner host (SSH alias `nexamail`). On that host:

- PostgreSQL 16 and Redis 7 are installed at the OS level and bind to `127.0.0.1` only.
- Several other tenants (Aravam Tune, VoxTN CMS/Platform, Umami, etc.) are already running on this host — some as systemd services, some as containers. Public HTTP(S) is terminated by the host-level nginx.

We need containerized VoxMail services to:

1. Reach the host's Postgres and Redis without reconfiguring them to listen on a bridge interface or `0.0.0.0` (which would weaken isolation for every tenant on the box).
2. Use the same DB/Redis connection strings in local development (Docker Desktop on Windows/Mac) as on the Hetzner host, so `.env` doesn't need per-environment rewrites.
3. Expose only internal endpoints — public traffic routes through the existing host nginx, not directly to container ports.

## Decision

1. **Containers reach the host via `host.docker.internal`.**
   On Docker Desktop (Windows/Mac) this DNS name is defined automatically. On Linux it is **not**, so `docker-compose.yml` maps it explicitly for every service that needs host access:

   ```yaml
   extra_hosts:
     - "host.docker.internal:host-gateway"
   ```

   `host-gateway` is a Docker-provided magic value that resolves to the host's gateway IP inside the container's network namespace.

2. **Connection strings use `host.docker.internal` in all environments.**
   - `DATABASE_URL=postgresql://nexamail_user:<pw>@host.docker.internal:5432/nexamail`
   - `REDIS_URL=redis://host.docker.internal:6379/4`

   This gives one `.env` that works on a developer laptop with Docker Desktop **and** on the Hetzner host, with no per-environment templating.

3. **Container ports bind to `127.0.0.1` on the host.**
   Published as `"127.0.0.1:4001:4001"` and `"127.0.0.1:4002:4002"` — never `0.0.0.0`. Public access is added later by proxying through the existing host nginx.

## Alternatives considered

- **`172.17.0.1` (default Docker bridge gateway).** Works, but the address isn't stable across Docker versions / custom networks, and `.env` would have to differ between local and host. Rejected.
- **`--network host`.** Simplest — containers share the host network namespace. Rejected because it removes the network boundary we rely on for port isolation on a shared multi-tenant box.
- **Run Postgres/Redis inside the compose stack.** Would avoid the host-gateway problem entirely, but we deliberately share the host instances with other tenants (DCR-NM-001 / NM-002 covered that). Out of scope here.
- **Publish ports to `0.0.0.0` and firewall.** Adds a failure mode: a misconfigured firewall exposes the service. Rejected in favor of not publishing publicly at the container layer at all.

## Consequences

- Every new service in `infra/docker-compose.yml` that needs host DB/Redis must include the `extra_hosts: host.docker.internal:host-gateway` block. A future compose linter / CI check could enforce this.
- A developer without Docker Desktop on Linux (using Docker Engine directly) also benefits from this — `host.docker.internal` works there too once the mapping is in place.
- Public exposure is a separate concern handled by nginx; we will not accidentally leak a service by adding it to compose.

## References

- Docker docs: [networking — special DNS name `host.docker.internal`](https://docs.docker.com/desktop/networking/#i-want-to-connect-from-a-container-to-a-service-on-the-host)
- Docker Engine 20.10+ introduced the `host-gateway` extra_hosts value for Linux.
