-- 006 — contacts + messages (B1 unified contact timeline).
-- Applied 2026-06-04 on nexamail (additive; smoked: 2-emails-one-timeline + idempotent upsert).
--
-- Unified contact timeline: messages grouped by contact across channels.
-- Email is the first channel; SMS/WhatsApp/voice slot in via channel column.
-- IMAP bridge ingests email via /timeline/ingest; other channels follow.
-- contacts.unique(tenant_email, email) makes upsert idempotent.
-- messages.unique(tenant_email, channel, external_id) prevents duplicate ingest.

CREATE TABLE IF NOT EXISTS contacts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_email TEXT NOT NULL,
    email        TEXT NOT NULL,
    name         TEXT,
    phone        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_email, email)
);

CREATE INDEX IF NOT EXISTS contacts_tenant_email_idx
    ON contacts (tenant_email, email);

CREATE TABLE IF NOT EXISTS messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    tenant_email TEXT NOT NULL,
    channel     TEXT NOT NULL DEFAULT 'email'
                    CHECK (channel IN ('email', 'sms', 'whatsapp', 'voice')),
    direction   TEXT NOT NULL DEFAULT 'inbound'
                    CHECK (direction IN ('inbound', 'outbound')),
    external_id TEXT,
    subject     TEXT,
    snippet     TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_email, channel, external_id)
);

CREATE INDEX IF NOT EXISTS messages_contact_occurred_idx
    ON messages (contact_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS messages_tenant_occurred_idx
    ON messages (tenant_email, occurred_at DESC);

ALTER TABLE contacts OWNER TO nexamail_user;
ALTER TABLE messages OWNER TO nexamail_user;
