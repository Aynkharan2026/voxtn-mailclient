import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireInternalToken } from '../auth.js';
import { pool } from '../db.js';
import { campaignQueue } from '../queue.js';

const campaignBodySchema = z.object({
  subject: z.string().min(1).max(998),
  html: z.string().min(1),
  recipients: z.array(z.string().email()).min(1).max(10_000),
  smtp: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    secure: z.boolean(),
    user: z.string().min(1),
    pass: z.string().min(1),
  }),
});

export const campaignRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireInternalToken);

  app.post('/campaigns', async (request, reply) => {
    const parsed = campaignBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid payload',
        details: parsed.error.format(),
      });
    }
    const { subject, html, recipients, smtp } = parsed.data;

    // Dedupe recipients case-insensitively. Technically the local part of an
    // email address is case-sensitive per RFC 5321, but in practice every
    // mail provider treats it as case-insensitive, and deduping avoids
    // sending the same person two copies when they paste a messy list.
    const unique = Array.from(
      new Set(recipients.map((r) => r.trim().toLowerCase())),
    ).filter((r) => r.length > 0);

    if (unique.length === 0) {
      return reply.code(400).send({ error: 'no valid recipients after dedupe' });
    }

    const client = await pool.connect();
    let campaignId: string;
    let recipientRows: { id: string; email: string }[];

    try {
      await client.query('BEGIN');

      const campaignRes = await client.query<{ id: string }>(
        `INSERT INTO campaigns (subject, html, smtp_host, smtp_user)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [subject, html, smtp.host, smtp.user],
      );
      const firstRow = campaignRes.rows[0];
      if (!firstRow) {
        throw new Error('campaigns insert returned no id');
      }
      campaignId = firstRow.id;

      const placeholders = unique.map((_, i) => `($1, $${i + 2})`).join(',');
      const recipientsRes = await client.query<{ id: string; email: string }>(
        `INSERT INTO campaign_recipients (campaign_id, email)
         VALUES ${placeholders}
         RETURNING id, email`,
        [campaignId, ...unique],
      );
      recipientRows = recipientsRes.rows;

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Enqueue one job per recipient. Rate-limited worker drains at 10/min.
    for (const r of recipientRows) {
      const messageId = `${randomUUID()}@voxmail.voxtn.com`;
      await campaignQueue.add(
        'send-campaign-email',
        {
          campaignId,
          recipientId: r.id,
          smtp,
          message: {
            messageId,
            from: smtp.user,
            to: r.email,
            subject,
            html,
          },
        },
        {
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
    }

    return reply
      .code(201)
      .send({ campaignId, queued: recipientRows.length });
  });
};
