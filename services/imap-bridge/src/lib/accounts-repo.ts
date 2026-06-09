/**
 * accounts-repo.ts — Read-only data-access helpers for the accounts table.
 *
 * A1 scope: list + get only.  Write endpoints (account CRUD) are deferred to A2.
 * This module is the seam that A2's account-management routes will import.
 */

import { pool } from '../db.js';
import type { Account } from './account-creds.js';

/**
 * Return all accounts for a tenant (or all accounts if tenant_email is omitted).
 * Active-only filtering is intentionally left to callers to keep the seam flexible.
 */
export async function listAccounts(tenant_email?: string): Promise<Account[]> {
  if (tenant_email) {
    const { rows } = await pool.query<Account>(
      `SELECT id, tenant_email, email_address, display_name, provider, auth_type,
              imap_host, imap_port, imap_secure,
              smtp_host, smtp_port, smtp_secure,
              cred_ref, active, created_at
         FROM accounts
        WHERE tenant_email = $1
        ORDER BY created_at DESC`,
      [tenant_email.toLowerCase()],
    );
    return rows;
  }

  const { rows } = await pool.query<Account>(
    `SELECT id, tenant_email, email_address, display_name, provider, auth_type,
            imap_host, imap_port, imap_secure,
            smtp_host, smtp_port, smtp_secure,
            cred_ref, active, created_at
       FROM accounts
      ORDER BY tenant_email, created_at DESC`,
  );
  return rows;
}

/**
 * Return a single account by UUID, or null if not found.
 */
export async function getAccountById(id: string): Promise<Account | null> {
  const { rows } = await pool.query<Account>(
    `SELECT id, tenant_email, email_address, display_name, provider, auth_type,
            imap_host, imap_port, imap_secure,
            smtp_host, smtp_port, smtp_secure,
            cred_ref, active, created_at
       FROM accounts
      WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}
