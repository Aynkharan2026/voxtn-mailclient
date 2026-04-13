-- 004 — tenants (Phase 6 Step 2 — white-label provisioning).
-- Applied 2026-04-13 on nexamail.
--
-- One row per brand/customer; apps/web looks up its current tenant by slug
-- and injects primary_color + name + logo_url into the layout.

CREATE TABLE IF NOT EXISTS tenants (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug              TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    plan_tier         TEXT NOT NULL DEFAULT 'free'
                        CHECK (plan_tier IN ('free','starter','pro','enterprise')),
    clerk_org_id      TEXT,
    primary_color     TEXT NOT NULL DEFAULT '#f59e0b',
    logo_url          TEXT,
    custom_domain     TEXT,
    imap_bridge_url   TEXT NOT NULL DEFAULT 'https://imap.nexamail.voxtn.com',
    ai_bridge_url     TEXT NOT NULL DEFAULT 'https://ai.nexamail.voxtn.com',
    crm_api_url       TEXT,
    crm_api_key_hint  TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenants_slug_idx ON tenants (slug);
CREATE INDEX IF NOT EXISTS tenants_plan_tier_idx ON tenants (plan_tier);

-- Seed three existing clients (idempotent — re-running the migration leaves
-- them alone after first creation).
INSERT INTO tenants (slug, name, plan_tier) VALUES
    ('voxtn',       'VoxTN Internal', 'enterprise'),
    ('carvia',      'Carvia',         'pro'),
    ('realtorsuba', 'RealtorSuba',    'pro')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE tenants OWNER TO nexamail_user;
