import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { logAudit } from '../audit.js';
import { requireInternalToken } from '../auth.js';
import { pool } from '../db.js';
import { fetchSharedInboxMessages } from '../imap-fetch.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SharedInboxRow = {
  id: string;
  tenant_email: string;
  name: string;
  email_address: string;
  assigned_rep_emails: string[];
  supervisor_emails: string[];
  created_at: string;
};

const createBodySchema = z.object({
  tenant_email: z.string().email(),
  name: z.string().min(1).max(120),
  email_address: z.string().email(),
  assigned_rep_emails: z.array(z.string().email()).optional(),
  supervisor_emails: z.array(z.string().email()).optional(),
});

const addEmailBodySchema = z.object({
  email: z.string().email(),
});

const fetchMessagesBodySchema = z.object({
  imap: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    secure: z.boolean(),
    user: z.string().min(1),
    pass: z.string().min(1),
  }),
  limit: z.number().int().min(1).max(100).optional(),
  requested_by: z.string().email().optional(),
});

function lowercaseArray(arr: string[] | undefined): string[] {
  return (arr ?? []).map((e) => e.trim().toLowerCase());
}

function parseUuidOr404(id: string, reply: FastifyReply): boolean {
  if (!UUID_RE.test(id)) {
    reply.code(400).send({ error: 'invalid shared inbox id' });
    return false;
  }
  return true;
}

async function loadInbox(id: string): Promise<SharedInboxRow | null> {
  const { rows } = await pool.query<SharedInboxRow>(
    `SELECT id, tenant_email, name, email_address,
            assigned_rep_emails, supervisor_emails, created_at
       FROM shared_inboxes WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export const sharedInboxRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireInternalToken);

  // -----------------------------------------------------------------
  // POST /shared-inboxes  — create
  // -----------------------------------------------------------------
  app.post('/shared-inboxes', async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid payload',
        details: parsed.error.format(),
      });
    }
    const b = parsed.data;
    try {
      const { rows } = await pool.query<SharedInboxRow>(
        `INSERT INTO shared_inboxes
            (tenant_email, name, email_address, assigned_rep_emails, supervisor_emails)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tenant_email, name, email_address,
                   assigned_rep_emails, supervisor_emails, created_at`,
        [
          b.tenant_email.toLowerCase(),
          b.name,
          b.email_address.toLowerCase(),
          lowercaseArray(b.assigned_rep_emails),
          lowercaseArray(b.supervisor_emails),
        ],
      );
      return reply.code(201).send(rows[0]);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        return reply
          .code(409)
          .send({ error: 'shared inbox with this email_address already exists' });
      }
      throw err;
    }
  });

  // -----------------------------------------------------------------
  // GET /shared-inboxes?tenant_email=
  // -----------------------------------------------------------------
  app.get<{ Querystring: { tenant_email?: string } }>(
    '/shared-inboxes',
    async (request, reply) => {
      const tenantEmail = request.query.tenant_email;
      if (!tenantEmail) {
        return reply.code(400).send({ error: 'tenant_email query param is required' });
      }
      const { rows } = await pool.query<SharedInboxRow>(
        `SELECT id, tenant_email, name, email_address,
                assigned_rep_emails, supervisor_emails, created_at
           FROM shared_inboxes
          WHERE tenant_email = $1
          ORDER BY created_at DESC`,
        [tenantEmail.toLowerCase()],
      );
      return { inboxes: rows };
    },
  );

  // -----------------------------------------------------------------
  // POST /shared-inboxes/:id/assign
  // -----------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/shared-inboxes/:id/assign',
    async (request, reply) => {
      const { id } = request.params;
      if (!parseUuidOr404(id, reply)) return;

      const parsed = addEmailBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid payload',
          details: parsed.error.format(),
        });
      }
      const email = parsed.data.email.trim().toLowerCase();

      const { rows } = await pool.query<SharedInboxRow>(
        `UPDATE shared_inboxes
            SET assigned_rep_emails = CASE
                  WHEN $1 = ANY(assigned_rep_emails) THEN assigned_rep_emails
                  ELSE array_append(assigned_rep_emails, $1)
                END
          WHERE id = $2
      RETURNING id, tenant_email, name, email_address,
                assigned_rep_emails, supervisor_emails, created_at`,
        [email, id],
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'shared inbox not found' });
      }
      return rows[0];
    },
  );

  // -----------------------------------------------------------------
  // POST /shared-inboxes/:id/supervise
  // -----------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/shared-inboxes/:id/supervise',
    async (request, reply) => {
      const { id } = request.params;
      if (!parseUuidOr404(id, reply)) return;

      const parsed = addEmailBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid payload',
          details: parsed.error.format(),
        });
      }
      const email = parsed.data.email.trim().toLowerCase();

      const { rows } = await pool.query<SharedInboxRow>(
        `UPDATE shared_inboxes
            SET supervisor_emails = CASE
                  WHEN $1 = ANY(supervisor_emails) THEN supervisor_emails
                  ELSE array_append(supervisor_emails, $1)
                END
          WHERE id = $2
      RETURNING id, tenant_email, name, email_address,
                assigned_rep_emails, supervisor_emails, created_at`,
        [email, id],
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'shared inbox not found' });
      }
      return rows[0];
    },
  );

  // -----------------------------------------------------------------
  // POST /shared-inboxes/:id/messages
  //   (spec said GET; implemented as POST because fetch() can't carry
  //    a body on GET — see DCR at summary time.)
  // -----------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/shared-inboxes/:id/messages',
    async (request, reply) => {
      const { id } = request.params;
      if (!parseUuidOr404(id, reply)) return;

      const parsed = fetchMessagesBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid payload',
          details: parsed.error.format(),
        });
      }

      const inbox = await loadInbox(id);
      if (!inbox) return reply.code(404).send({ error: 'shared inbox not found' });

      const headerUser = (request.headers['x-voxmail-user'] ?? '')
        .toString()
        .toLowerCase();
      const bodyUser = parsed.data.requested_by?.toLowerCase();
      const accessedBy =
        headerUser || bodyUser || parsed.data.imap.user.toLowerCase();

      const canAccess =
        inbox.assigned_rep_emails.includes(accessedBy) ||
        inbox.supervisor_emails.includes(accessedBy) ||
        inbox.tenant_email === accessedBy;
      if (!canAccess) {
        return reply.code(403).send({
          error: 'caller is not assigned to or supervising this shared inbox',
        });
      }

      try {
        const messages = await fetchSharedInboxMessages(
          parsed.data.imap,
          parsed.data.limit ?? 20,
        );

        await logAudit({
          ownerEmail: accessedBy,
          action: 'shared_inbox_accessed',
          payload: {
            sharedInboxId: id,
            accessedBy,
            messageCount: messages.length,
          },
          ipAddress: request.ip,
        });

        return { messages };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply
          .code(502)
          .send({ error: 'imap fetch failed', detail: msg });
      }
    },
  );

  // -----------------------------------------------------------------
  // GET /shared-inboxes/:id/audit — supervisor only
  // -----------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/shared-inboxes/:id/audit',
    async (request: FastifyRequest, reply) => {
      const { id } = (request.params ?? {}) as { id: string };
      if (!parseUuidOr404(id, reply)) return;

      const headerUser = (request.headers['x-voxmail-user'] ?? '')
        .toString()
        .toLowerCase();
      if (!headerUser) {
        return reply
          .code(401)
          .send({ error: 'missing X-Voxmail-User header' });
      }

      const inbox = await loadInbox(id);
      if (!inbox) return reply.code(404).send({ error: 'shared inbox not found' });

      if (!inbox.supervisor_emails.includes(headerUser)) {
        return reply
          .code(403)
          .send({ error: 'not a supervisor of this shared inbox' });
      }

      const { rows } = await pool.query(
        `SELECT id, owner_email, action, payload, ip_address, created_at
           FROM audit_log
          WHERE payload->>'sharedInboxId' = $1
          ORDER BY created_at DESC
          LIMIT 50`,
        [id],
      );
      return { events: rows, count: rows.length };
    },
  );
};
