-- 003 — billing_usage (Phase 6 Step 1 — Stripe billing + feature gates).
-- Applied 2026-04-13 on nexamail.
--
-- One row per owner_email. stripe_customer_id also unique to avoid
-- webhook double-inserts. Absence of a row == free tier.

CREATE TABLE IF NOT EXISTS billing_usage (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_email            TEXT NOT NULL UNIQUE,
    plan_tier              TEXT NOT NULL DEFAULT 'free'
                             CHECK (plan_tier IN ('free','starter','pro','enterprise')),
    stripe_customer_id     TEXT UNIQUE,
    stripe_subscription_id TEXT,
    mailboxes_used         INTEGER NOT NULL DEFAULT 0,
    ai_calls_this_month    INTEGER NOT NULL DEFAULT 0,
    period_start           TIMESTAMPTZ,
    period_end             TIMESTAMPTZ,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS billing_usage_stripe_customer_idx
    ON billing_usage (stripe_customer_id);

ALTER TABLE billing_usage OWNER TO nexamail_user;
