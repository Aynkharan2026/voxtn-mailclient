import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireInternalToken } from '../auth.js';
import { pool } from '../db.js';
import { getTimeline, ingestEmail } from '../timeline.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ingestBodySchema = z.object({
  tenant_email: z.string().email(),
  from: z.object({
    email: z.string().email(),
    name: z.string().optional(),
  }),
  subject: z.string().optional(),
  snippet: z.string().optional(),
  external_id: z.string().optional(),
  occurred_at: z.string().datetime().optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
});

type ContactRow = {
  id: string;
  tenant_email: string;
  email: string;
  name: string | null;
  phone: string | null;
  created_at: string;
};

export const timelineRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireInternalToken);

  // -----------------------------------------------------------------
  // GET /contacts?tenant_email=  — list contacts for a tenant
  // -----------------------------------------------------------------
  app.get<{ Querystring: { tenant_email?: string } }>(
    '/contacts',
    async (request, reply) => {
      const tenantEmail = request.query.tenant_email;
      if (!tenantEmail) {
        return reply
          .code(400)
          .send({ error: 'tenant_email query param is required' });
      }
      const { rows } = await pool.query<ContactRow>(
        `SELECT id, tenant_email, email, name, phone, created_at
           FROM contacts
          WHERE tenant_email = $1
          ORDER BY created_at DESC`,
        [tenantEmail.toLowerCase()],
      );
      return { contacts: rows };
    },
  );

  // -----------------------------------------------------------------
  // GET /contacts/:id/timeline  — messages for a contact
  // -----------------------------------------------------------------
  app.get<{ Params: { id: string }; Querystring: { tenant_email?: string; limit?: string } }>(
    '/contacts/:id/timeline',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) {
        return reply.code(400).send({ error: 'invalid contact id' });
      }
      const tenantEmail = request.query.tenant_email;
      if (!tenantEmail) {
        return reply
          .code(400)
          .send({ error: 'tenant_email query param is required' });
      }
      const limit = Math.min(
        parseInt(request.query.limit ?? '100', 10) || 100,
        500,
      );
      const messages = await getTimeline(tenantEmail, id, limit);
      return { contact_id: id, messages };
    },
  );

  // -----------------------------------------------------------------
  // POST /timeline/ingest  — ingest an email event into the timeline
  // -----------------------------------------------------------------
  app.post('/timeline/ingest', async (request, reply) => {
    const parsed = ingestBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid payload',
        details: parsed.error.format(),
      });
    }
    const b = parsed.data;
    const occurredAt = b.occurred_at ? new Date(b.occurred_at) : undefined;
    const { contactId, messageId } = await ingestEmail(
      b.tenant_email,
      b.from,
      b.subject,
      b.snippet,
      b.external_id,
      occurredAt,
      b.direction ?? 'inbound',
    );
    return reply.code(201).send({ contactId, messageId });
  });
};
