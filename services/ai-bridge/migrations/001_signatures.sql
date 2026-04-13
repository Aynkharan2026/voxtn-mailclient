-- 001 — signatures table
-- Applied 2026-04-13 on nexamail (VoxMail Phase 3.4).
--
-- Keyed by owner_email for the MVP. Will be rekeyed to user_id in Phase 4
-- when the account/user model lands.

CREATE TABLE IF NOT EXISTS signatures (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_email  TEXT NOT NULL,
    name         TEXT NOT NULL,
    html_content TEXT NOT NULL,
    is_default   BOOLEAN NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one default signature per owner (partial unique index: only
-- enforced when is_default = true, so many non-default rows coexist).
CREATE UNIQUE INDEX IF NOT EXISTS signatures_one_default_per_owner
    ON signatures (owner_email)
    WHERE is_default = true;

-- Lookup by owner (common list / get-default path).
CREATE INDEX IF NOT EXISTS signatures_owner_email_idx
    ON signatures (owner_email);

-- Migration runs as postgres (superuser); the app connects as nexamail_user.
-- Transfer ownership so the app can CRUD without explicit grants.
ALTER TABLE signatures OWNER TO nexamail_user;
