-- 001 — campaigns + campaign_recipients (voxmail-imap Phase 5).
-- Applied 2026-04-13 on nexamail.
--
-- Stores mass-send campaigns and per-recipient delivery state. SMTP
-- credentials are NOT persisted here per DCR-NM-004; only host + user
-- are recorded for audit. The password lives only in the BullMQ job
-- payload (Redis) until the job is consumed.

CREATE TABLE IF NOT EXISTS campaigns (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject    TEXT NOT NULL,
    html       TEXT NOT NULL,
    smtp_host  TEXT NOT NULL,
    smtp_user  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','sending','sent','failed')),
    error       TEXT,
    message_id  TEXT,
    sent_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaign_recipients_campaign_id_idx
    ON campaign_recipients (campaign_id, status);

ALTER TABLE campaigns             OWNER TO nexamail_user;
ALTER TABLE campaign_recipients   OWNER TO nexamail_user;
