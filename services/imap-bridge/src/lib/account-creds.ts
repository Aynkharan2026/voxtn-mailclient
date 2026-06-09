/**
 * account-creds.ts — Vault resolver for per-account IMAP/SMTP credentials.
 *
 * Credentials are NEVER stored in the DB.  The DB row carries only a `cred_ref`
 * slug that maps to /opt/voxtn-secrets/voxmail-accounts/<cred_ref>.env (DCR-NM-004).
 * This module reads that file at runtime, combines it with the non-secret
 * connection metadata from the account row, and returns usable creds in-memory.
 *
 * HARD RULES enforced here:
 *   - No secret value is ever logged, thrown, or returned in error messages.
 *   - Only cred_ref + which fields were found (boolean) may appear in logs.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// -------------------------------------------------------------------------
// Typed interface mirroring the accounts table (no secret columns).
// -------------------------------------------------------------------------
export interface Account {
  id: string;
  tenant_email: string;
  email_address: string;
  display_name: string | null;
  provider: string;
  auth_type: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  cred_ref: string;
  active: boolean;
  created_at: string;
}

export interface AccountCreds {
  imap: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
}

const VAULT_DIR = '/opt/voxtn-secrets/voxmail-accounts';

/**
 * Parse a simple KEY=VALUE .env file.  Lines starting with # are ignored.
 * No interpolation; values may optionally be quoted with single or double quotes.
 */
function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const raw of contents.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip surrounding quotes (single or double)
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

/**
 * Resolve IMAP + SMTP credentials for an account row.
 *
 * Reads /opt/voxtn-secrets/voxmail-accounts/<cred_ref>.env and merges with
 * the non-secret metadata from the account row.
 *
 * Expected env-file keys (IMAP_USER / SMTP_USER fall back to account.email_address):
 *   IMAP_PASS  (required)
 *   SMTP_PASS  (required; falls back to IMAP_PASS if absent)
 *   IMAP_USER  (optional; defaults to account.email_address)
 *   SMTP_USER  (optional; defaults to IMAP_USER)
 *
 * Throws a non-secret error if the vault file is missing or IMAP_PASS is absent.
 */
export function resolveAccountCreds(account: Account): AccountCreds {
  const vaultPath = join(VAULT_DIR, `${account.cred_ref}.env`);

  let raw: string;
  try {
    raw = readFileSync(vaultPath, 'utf8');
  } catch {
    // Do NOT include vaultPath (could leak org-internal topology) or secret values.
    throw new Error(`cred_ref vault file not found for ${account.cred_ref}`);
  }

  const env = parseEnvFile(raw);

  const imapPass = env['IMAP_PASS'] ?? '';
  if (!imapPass) {
    throw new Error(`cred_ref vault file for ${account.cred_ref} is missing IMAP_PASS`);
  }
  const smtpPass = env['SMTP_PASS'] ?? imapPass;
  const imapUser = env['IMAP_USER'] ?? account.email_address;
  const smtpUser = env['SMTP_USER'] ?? imapUser;

  // Log only presence/absence of fields — never values.
  // (Logger is not imported here to keep this module dependency-free;
  //  callers may log at their own discretion using only the cred_ref slug.)
  const _ = {
    cred_ref: account.cred_ref,
    hasImapUser: Boolean(env['IMAP_USER']),
    hasSmtpUser: Boolean(env['SMTP_USER']),
    hasSmtpPass: Boolean(env['SMTP_PASS']),
  };
  void _; // available for callers to spread into their log entry if desired

  return {
    imap: {
      host: account.imap_host,
      port: account.imap_port,
      secure: account.imap_secure,
      user: imapUser,
      pass: imapPass,
    },
    smtp: {
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_secure,
      user: smtpUser,
      pass: smtpPass,
    },
  };
}
