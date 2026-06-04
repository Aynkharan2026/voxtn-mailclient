import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireInternalToken } from '../auth.js';
import { isOptedOut, listOptedOut, optOut } from '../optout.js';

const postBodySchema = z.object({
  email: z.string().email(),
  source: z.string().min(1).max(120),
});

const checkQuerySchema = z.object({
  email: z.string().email(),
});

export const optoutRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireInternalToken);

  // POST /optout — add an email to the global opt-out list
  app.post('/optout', async (request, reply) => {
    const parsed = postBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid payload',
        details: parsed.error.format(),
      });
    }
    const { email, source } = parsed.data;
    await optOut(email, source);
    return reply.code(200).send({ ok: true, email: email.toLowerCase() });
  });

  // GET /optout/check?email= — check if an email is opted out
  app.get<{ Querystring: { email?: string } }>(
    '/optout/check',
    async (request, reply) => {
      const parsed = checkQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid query',
          details: parsed.error.format(),
        });
      }
      const email = parsed.data.email.toLowerCase();
      const opted_out = await isOptedOut(email);
      return { email, opted_out };
    },
  );

  // GET /optout — list all opted-out addresses
  app.get('/optout', async (_request, _reply) => {
    const entries = await listOptedOut();
    return { entries };
  });
};
