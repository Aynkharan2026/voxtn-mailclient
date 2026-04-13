import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { logAudit } from '../audit.js';
import { requireInternalToken } from '../auth.js';
import { pool } from '../db.js';
import { campaignQueue } from '../queue.js';

const campaignBodySchema = z.object({
  name: z.string().min(1).max(200),
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const { name, subject, html, recipients, smtp } = parsed.data;

    // 1. dedupe (case-insensitive)
    const deduped = Array.from(
      new Set(recipients.map((r) => r.trim().toLowerCase())),
    ).filter((r) => r.length > 0);

    if (deduped.length === 0) {
      return reply.code(400).send({ error: 'no valid recipients after dedupe' });
    }

    // 2. filter out unsubscribed recipients (CASL)
    const unsubRes = await pool.query<{ email: string }>(
      'SELECT email FROM unsubscribes WHERE email = ANY($1)',
      [deduped],
    );
    const unsubscribed = new Set(unsubRes.rows.map((r) => r.email));
    const toSend = deduped.filter((r) => !unsubscribed.has(r));
    const skippedUnsubscribed = deduped.length - toSend.length;

    // 3. persist campaign row (always create, even when toSend is empty)
    const client = await pool.connect();
    let campaignId: string;
    let recipientRows: { id: string; email: string }[] = [];
    const ownerEmail = smtp.user.toLowerCase();

    try {
      await client.query('BEGIN');

      const initialStatus = toSend.length === 0 ? 'complete' : 'sending';
      const campaignRes = await client.query<{ id: string }>(
        `INSERT INTO campaigns (owner_email, name, subject, html_body, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [ownerEmail, name, subject, html, initialStatus],
      );
      const firstRow = campaignRes.rows[0];
      if (!firstRow) throw new Error('campaigns insert returned no id');
      campaignId = firstRow.id;

      if (toSend.length > 0) {
        const placeholders = toSend.map((_, i) => `($1, $${i + 2})`).join(',');
        const recipientsRes = await client.query<{ id: string; email: string }>(
          `INSERT INTO campaign_recipients (campaign_id, email)
           VALUES ${placeholders}
           RETURNING id, email`,
          [campaignId, ...toSend],
        );
        recipientRows = recipientsRes.rows;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // 4. enqueue one job per recipient
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
          ownerEmail,
        },
        {
          removeOnComplete: 1000,
          removeOnFail: 5000,
          attempts: 2,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
    }

    // 5. audit log
    await logAudit({
      ownerEmail,
      action: 'campaign_created',
      payload: {
        campaignId,
        recipientCount: recipientRows.length,
        skippedUnsubscribed,
        dedupedFrom: recipients.length,
      },
      ipAddress: request.ip,
    });

    return reply.code(201).send({
      campaignId,
      queued: recipientRows.length,
    });
  });

  app.get<{ Params: { id: string } }>(
    '/campaigns/:id/status',
    async (request, reply) => {
      const { id } = request.params;
      if (!UUID_RE.test(id)) {
        return reply.code(400).send({ error: 'invalid campaign id' });
      }

      const { rows } = await pool.query<{
        total: string;
        sent: number;
        failed: string;
        open_count: number;
        click_count: number;
        status: string;
      }>(
        `SELECT
            c.status,
            c.open_count,
            c.click_count,
            c.sent_count                                       AS sent,
            (SELECT COUNT(*) FROM campaign_recipients
                WHERE campaign_id = c.id)                      AS total,
            (SELECT COUNT(*) FROM campaign_recipients
                WHERE campaign_id = c.id AND status = 'failed') AS failed
           FROM campaigns c
          WHERE c.id = $1`,
        [id],
      );

      const row = rows[0];
      if (!row) return reply.code(404).send({ error: 'campaign not found' });

      return {
        total: Number(row.total),
        sent: Number(row.sent),
        failed: Number(row.failed),
        open_count: Number(row.open_count),
        click_count: Number(row.click_count),
        status: row.status,
      };
    },
  );
};
