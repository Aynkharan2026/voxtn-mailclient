import Fastify from 'fastify';
import pino from 'pino';

const logger = pino({
  level: process.env.IMAP_BRIDGE_LOG_LEVEL ?? 'info',
  redact: ['req.headers.authorization', '*.password', '*.token'],
});

const app = Fastify({ loggerInstance: logger });

app.get('/health', async () => ({
  service: 'nexamail-imap',
  status: 'ok',
  time: new Date().toISOString(),
}));

const port = Number(process.env.IMAP_BRIDGE_PORT ?? 4001);

app.listen({ host: '0.0.0.0', port }).catch((err) => {
  logger.error(err);
  process.exit(1);
});
