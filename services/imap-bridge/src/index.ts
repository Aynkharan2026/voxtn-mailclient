import Fastify from 'fastify';
import pino from 'pino';

import { config } from './config.js';
import { startCampaignWorker, startSendWorker } from './queue.js';
import { auditRoutes } from './routes/audit.js';
import { campaignRoutes } from './routes/campaigns.js';
import { sendRoutes } from './routes/send.js';
import { unsubscribeRoutes } from './routes/unsubscribe.js';

const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      '*.password',
      '*.token',
      '*.smtp.pass',
      '*.smtp.user',
      'smtp.pass',
      'smtp.user',
    ],
    censor: '[REDACTED]',
  },
});

const app = Fastify({ loggerInstance: logger, trustProxy: true });

app.get('/health', async () => ({
  service: 'voxmail-imap',
  status: 'ok',
  time: new Date().toISOString(),
}));

await app.register(sendRoutes);
await app.register(campaignRoutes);
await app.register(unsubscribeRoutes);
await app.register(auditRoutes);

startSendWorker();
startCampaignWorker();

app.listen({ host: '0.0.0.0', port: config.port }).catch((err) => {
  logger.error(err);
  process.exit(1);
});
