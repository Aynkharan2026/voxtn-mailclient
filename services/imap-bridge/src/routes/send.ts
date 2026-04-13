import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireInternalToken } from '../auth.js';
import { sendQueue, UNDO_DELAY_MS, type SendJobMessage } from '../queue.js';

const sendBodySchema = z.object({
  to: z.string().min(1),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  subject: z.string(),
  html: z.string(),
  smtp: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    secure: z.boolean(),
    user: z.string().min(1),
    pass: z.string().min(1),
  }),
});

const cancelQuerySchema = z.object({
  jobId: z.string().min(1),
});

export const sendRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireInternalToken);

  app.post('/send', async (request, reply) => {
    const parsed = sendBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid payload', details: parsed.error.format() });
    }
    const { smtp, to, cc, bcc, subject, html } = parsed.data;
    const messageId = `${randomUUID()}@voxmail.voxtn.com`;

    const message: SendJobMessage = {
      messageId,
      from: smtp.user,
      to,
      subject,
      html,
      ...(cc ? { cc } : {}),
      ...(bcc ? { bcc } : {}),
    };

    const job = await sendQueue.add(
      'send-email',
      { smtp, message },
      {
        delay: UNDO_DELAY_MS,
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    return { messageId, jobId: job.id };
  });

  app.post('/send/cancel', async (request, reply) => {
    const parsed = cancelQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'missing jobId' });
    }
    const { jobId } = parsed.data;

    const job = await sendQueue.getJob(jobId);
    if (!job) {
      return reply.code(404).send({ error: 'job not found' });
    }

    const state = await job.getState();
    if (state !== 'delayed' && state !== 'waiting') {
      return reply
        .code(409)
        .send({ error: 'job already processing or done', state });
    }

    await job.remove();
    return { cancelled: true, jobId };
  });
};
