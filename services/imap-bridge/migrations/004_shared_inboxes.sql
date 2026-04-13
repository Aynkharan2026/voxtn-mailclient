-- 004 — shared_inboxes (Phase 5 Step 3).
-- Applied 2026-04-13 on nexamail.
--
-- A shared mailbox (e.g. support@acme.com) can be worked by any rep in
-- assigned_rep_emails and observed by any supervisor in supervisor_emails.
-- IMAP credentials are NOT stored here (per DCR-NM-004) — they arrive in
-- the /messages request body at fetch time.

CREATE TABLE IF NOT EXISTS shared_inboxes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_email        TEXT NOT NULL,
    name                TEXT NOT NULL,
    email_address       TEXT NOT NULL UNIQUE,
    assigned_rep_emails TEXT[] NOT NULL DEFAULT '{}',
    supervisor_emails   TEXT[] NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shared_inboxes_tenant_email_idx
    ON shared_inboxes (tenant_email);

ALTER TABLE shared_inboxes OWNER TO nexamail_user;
