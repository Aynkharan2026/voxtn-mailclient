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

## Addendum (2026-04-13) — host services must bind to the docker bridge

`host-gateway` on Linux resolves to **`172.17.0.1`** (docker0), even when the container is on a user-defined compose network with a different subnet. For a container to actually *reach* a host service through that address, the service must be listening on `172.17.0.1` (or `0.0.0.0`) — not just `127.0.0.1`.

This is a hidden prerequisite not covered in the original DCR. It was discovered when BullMQ's ioredis client in `voxmail-imap` got `ECONNREFUSED 172.17.0.1:6379` while Redis was bound only to `127.0.0.1` on the host.

### Host config changes applied on `nexamail` (77.42.6.218)

**Redis** (`/etc/redis/redis.conf`):
- `bind 127.0.0.1 -::1 172.17.0.1` (was: `127.0.0.1 -::1`)
- `protected-mode no` (was: `yes`)
- Rationale for disabling protected-mode: with `172.17.0.1` added to `bind`, Redis rejects non-loopback connections when no password is set. Setting a password would break every other tenant on this host. Disabling protected-mode accepts that any Docker container on this host can connect — same trust boundary the other tenants already operate in (they all run on `127.0.0.1` and don't isolate between themselves).

**PostgreSQL** (`/etc/postgresql/16/main/postgresql.conf`):
- `listen_addresses = 'localhost,172.17.0.1'` (was: `localhost`)

**pg_hba.conf**: appended
```
host    all             all             172.16.0.0/12           md5
```
The `/12` CIDR covers every standard Docker-allocated subnet (172.16.0.0 – 172.31.255.255). `md5` auth means a password is always required; the CIDR change only affects *which source IPs* may attempt to authenticate.

### Operational note

If the Docker daemon is ever reconfigured to advertise a different default gateway (e.g. via `default-address-pool`), the `bind` / `listen_addresses` entries above must be updated to match. Until then the assumption holds: **containers on any bridge network reach the host at `172.17.0.1`**.

## References

- Docker docs: [networking — special DNS name `host.docker.internal`](https://docs.docker.com/desktop/networking/#i-want-to-connect-from-a-container-to-a-service-on-the-host)
- Docker Engine 20.10+ introduced the `host-gateway` extra_hosts value for Linux.
