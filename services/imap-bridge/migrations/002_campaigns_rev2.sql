-- 002 — campaigns schema rev2 (Phase 5 Step 1 final spec).
-- Applied 2026-04-13 on nexamail.
--
-- Drops the rev1 tables (001_campaigns.sql) and recreates with
-- owner_email / name / status / counters. Safe because rev1 has
-- only held ephemeral integration-test data.

DROP TABLE IF EXISTS campaign_recipients CASCADE;
DROP TABLE IF EXISTS campaigns           CASCADE;

CREATE TABLE campaigns (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_email  TEXT NOT NULL,
    name         TEXT NOT NULL,
    subject      TEXT NOT NULL,
    html_body    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'sending'
                   CHECK (status IN ('draft','sending','complete','failed')),
    sent_count   INTEGER NOT NULL DEFAULT 0,
    open_count   INTEGER NOT NULL DEFAULT 0,
    click_count  INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX campaigns_owner_email_idx
    ON campaigns (owner_email, created_at DESC);

CREATE TABLE campaign_recipients (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id  UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','sent','failed')),
    sent_at      TIMESTAMPTZ,
    error_msg    TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX campaign_recipients_campaign_id_idx
    ON campaign_recipients (campaign_id, status);

ALTER TABLE campaigns           OWNER TO nexamail_user;
ALTER TABLE campaign_recipients OWNER TO nexamail_user;
