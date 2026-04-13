import { pool } from './db.js';

export type AuditAction =
  | 'campaign_created'
  | 'email_sent'
  | 'email_failed'
  | 'unsubscribe'
  | 'unsubscribe_admin'
  | 'shared_inbox_accessed'
  | 'ownership_transferred';

export async function logAudit(params: {
  ownerEmail: string;
  action: AuditAction;
  payload: Record<string, unknown>;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (owner_email, action, payload, ip_address)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [
        params.ownerEmail.toLowerCase(),
        params.action,
        JSON.stringify(params.payload),
        params.ipAddress ?? null,
      ],
    );
  } catch (err) {
    // Audit writes should not take down the calling operation. Log to stderr
    // and continue. If the DB is down we have bigger problems anyway.
    // eslint-disable-next-line no-console
    console.error('audit_log insert failed:', err);
  }
}
