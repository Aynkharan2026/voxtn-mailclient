import { pool } from './db.js';

type ContactRow = { id: string };
type MessageRow = { id: string };

export type UpsertMessageParams = {
  tenantEmail: string;
  contactId: string;
  channel: 'email' | 'sms' | 'whatsapp' | 'voice';
  direction: 'inbound' | 'outbound';
  externalId?: string;
  subject?: string;
  snippet?: string;
  occurredAt?: Date;
};

export async function upsertContact(
  tenantEmail: string,
  email: string,
  name?: string,
): Promise<{ id: string }> {
  const { rows } = await pool.query<ContactRow>(
    `INSERT INTO contacts (tenant_email, email, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_email, email)
     DO UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name)
     RETURNING id`,
    [tenantEmail.toLowerCase(), email.toLowerCase(), name ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error('upsertContact: no row returned');
  return { id: row.id };
}

export async function upsertMessage(m: UpsertMessageParams): Promise<{ id: string }> {
  const occurredAt = m.occurredAt ?? new Date();
  const { rows } = await pool.query<MessageRow>(
    `INSERT INTO messages
        (contact_id, tenant_email, channel, direction, external_id, subject, snippet, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (tenant_email, channel, external_id)
     DO UPDATE SET
       subject     = COALESCE(EXCLUDED.subject,     messages.subject),
       snippet     = COALESCE(EXCLUDED.snippet,     messages.snippet),
       occurred_at = COALESCE(EXCLUDED.occurred_at, messages.occurred_at)
     RETURNING id`,
    [
      m.contactId,
      m.tenantEmail.toLowerCase(),
      m.channel,
      m.direction,
      m.externalId ?? null,
      m.subject ?? null,
      m.snippet ?? null,
      occurredAt,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('upsertMessage: no row returned');
  return { id: row.id };
}

export type MessageTimelineRow = {
  id: string;
  contact_id: string;
  tenant_email: string;
  channel: string;
  direction: string;
  external_id: string | null;
  subject: string | null;
  snippet: string | null;
  occurred_at: string;
  created_at: string;
};

export async function getTimeline(
  tenantEmail: string,
  contactId: string,
  limit = 100,
): Promise<MessageTimelineRow[]> {
  const { rows } = await pool.query<MessageTimelineRow>(
    `SELECT id, contact_id, tenant_email, channel, direction,
            external_id, subject, snippet, occurred_at, created_at
       FROM messages
      WHERE tenant_email = $1
        AND contact_id   = $2
      ORDER BY occurred_at DESC
      LIMIT $3`,
    [tenantEmail.toLowerCase(), contactId, limit],
  );
  return rows;
}

export async function ingestEmail(
  tenantEmail: string,
  from: { email: string; name?: string },
  subject?: string,
  snippet?: string,
  externalId?: string,
  occurredAt?: Date,
  direction: 'inbound' | 'outbound' = 'inbound',
): Promise<{ contactId: string; messageId: string }> {
  const { id: contactId } = await upsertContact(tenantEmail, from.email, from.name);
  const { id: messageId } = await upsertMessage({
    tenantEmail,
    contactId,
    channel: 'email',
    direction,
    externalId,
    subject,
    snippet,
    occurredAt,
  });
  return { contactId, messageId };
}
