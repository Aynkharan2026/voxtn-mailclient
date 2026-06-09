-- 007 — accounts (A1 multi-account data model).
-- Applied on nexamail (additive; smoked: accounts table + seed row).
--
-- Credentials are NOT stored here (cred_ref → on-box vault), consistent with DCR-NM-004.
-- The cred_ref slug maps to /opt/voxtn-secrets/voxmail-accounts/<cred_ref>.env (provisioned out-of-band).
-- smtp_secure=true means implicit TLS; port 587 uses STARTTLS (smtp_secure=true is used for 465/implicit,
-- but 587 with STARTTLS is handled by the SMTP client — see account-creds resolver).

CREATE TABLE IF NOT EXISTS accounts (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_email  TEXT        NOT NULL,
    email_address TEXT        NOT NULL,
    display_name  TEXT,
    provider      TEXT        NOT NULL,                -- 'voxtn' | 'gmail' | 'yahoo' | 'outlook'
    auth_type     TEXT        NOT NULL,                -- 'password' | 'app_password' | 'oauth'
    imap_host     TEXT        NOT NULL,
    imap_port     INT         NOT NULL DEFAULT 993,
    imap_secure   BOOLEAN     NOT NULL DEFAULT true,
    smtp_host     TEXT        NOT NULL,
    smtp_port     INT         NOT NULL DEFAULT 587,    -- 587 uses STARTTLS; 465 = implicit TLS
    smtp_secure   BOOLEAN     NOT NULL DEFAULT true,
    cred_ref      TEXT        NOT NULL,                -- slug → /opt/voxtn-secrets/voxmail-accounts/<cred_ref>.env (NOT the secret)
    active        BOOLEAN     NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_email, email_address)
);

CREATE INDEX IF NOT EXISTS accounts_tenant_email_idx
    ON accounts (tenant_email);

ALTER TABLE accounts OWNER TO nexamail_user;

-- Seed row: existing mcp@voxtn.com mailbox (idempotent)
INSERT INTO accounts
    (tenant_email, email_address, display_name, provider, auth_type,
     imap_host, imap_port, imap_secure,
     smtp_host, smtp_port, smtp_secure,
     cred_ref, active)
VALUES
    ('voxtn.com', 'mcp@voxtn.com', 'VoxMail MCP Inbox', 'voxtn', 'password',
     'mail.voxtn.com', 993, true,
     'mail.voxtn.com', 587, true,
     'mcp-voxtn', true)
ON CONFLICT (tenant_email, email_address) DO NOTHING;
