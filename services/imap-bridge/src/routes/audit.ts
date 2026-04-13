import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireInternalToken } from '../auth.js';
import { pool } from '../db.js';

const querySchema = z.object({
  owner_email: z.string().email(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(Math.max(parseInt(v, 10) || 100, 1), 500) : 100)),
});

export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireInternalToken);

  app.get('/audit-log', async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid query',
        details: parsed.error.format(),
      });
    }

    const { owner_email, limit } = parsed.data;

    const { rows } = await pool.query<{
      id: string;
      owner_email: string;
      action: string;
      payload: Record<string, unknown>;
      ip_address: string | null;
      created_at: string;
    }>(
      `SELECT id, owner_email, action, payload, ip_address, created_at
         FROM audit_log
        WHERE owner_email = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [owner_email.toLowerCase(), limit],
    );

    return { events: rows, count: rows.length };
  });
};
