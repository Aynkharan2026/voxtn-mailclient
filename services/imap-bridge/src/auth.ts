import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from './config.js';

export async function requireInternalToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!config.internalServiceToken) {
    reply.code(500).send({ error: 'service misconfigured' });
    return;
  }
  const header = request.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'missing bearer token' });
    return;
  }
  const token = header.slice('Bearer '.length);
  const a = Buffer.from(token);
  const b = Buffer.from(config.internalServiceToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    reply.code(401).send({ error: 'invalid token' });
    return;
  }
}
