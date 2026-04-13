-- 002 — tracking_events table
-- Applied 2026-04-13 on nexamail (VoxMail Phase 4 Step 3).
--
-- Records every open/click event served by the tracking.voxtn.com Cloudflare
-- Worker. Keyed by message_id (the UUID we pre-generate in voxmail-imap's
-- POST /send response, e.g. 'xxxx@voxmail.voxtn.com').

CREATE TABLE IF NOT EXISTS tracking_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id   TEXT NOT NULL,
    event_type   TEXT NOT NULL CHECK (event_type IN ('open', 'click')),
    redirect_url TEXT,
    user_agent   TEXT,
    ip           INET,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tracking_events_message_id_idx
    ON tracking_events (message_id, created_at);

ALTER TABLE tracking_events OWNER TO nexamail_user;
