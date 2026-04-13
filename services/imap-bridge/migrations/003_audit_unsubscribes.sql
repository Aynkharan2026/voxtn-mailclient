-- 003 — audit_log + unsubscribes (Phase 5 Step 2 / CASL compliance).
-- Applied 2026-04-13 on nexamail.

-- ------------------------------------------------------------
-- audit_log — append-only by trigger
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_email TEXT NOT NULL,
    action      TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_owner_email_idx
    ON audit_log (owner_email, created_at DESC);

-- Shared function used by both DELETE and TRUNCATE triggers. Works for
-- both row-level and statement-level contexts because it ignores OLD/NEW.
CREATE OR REPLACE FUNCTION audit_log_no_delete() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_prevent_delete   ON audit_log;
DROP TRIGGER IF EXISTS audit_log_prevent_truncate ON audit_log;

CREATE TRIGGER audit_log_prevent_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW
    EXECUTE FUNCTION audit_log_no_delete();

CREATE TRIGGER audit_log_prevent_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT
    EXECUTE FUNCTION audit_log_no_delete();

-- ------------------------------------------------------------
-- unsubscribes — suppression list, email-keyed
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS unsubscribes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source          TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS unsubscribes_email_idx ON unsubscribes (email);

-- ------------------------------------------------------------
-- Ownership for app connections
-- ------------------------------------------------------------

ALTER TABLE audit_log    OWNER TO nexamail_user;
ALTER TABLE unsubscribes OWNER TO nexamail_user;
-- The trigger function is owned by whoever ran this migration (postgres)
-- but SECURITY INVOKER is the default so it runs with the caller's privileges.
