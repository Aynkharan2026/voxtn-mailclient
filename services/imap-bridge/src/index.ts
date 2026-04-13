import Fastify from 'fastify';
import pino from 'pino';

import { config } from './config.js';
import { startCampaignWorker, startSendWorker } from './queue.js';
import { campaignRoutes } from './routes/campaigns.js';
import { sendRoutes } from './routes/send.js';

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

const app = Fastify({ loggerInstance: logger });

app.get('/health', async () => ({
  service: 'voxmail-imap',
  status: 'ok',
  time: new Date().toISOString(),
}));

await app.register(sendRoutes);
await app.register(campaignRoutes);

startSendWorker();
startCampaignWorker();

app.listen({ host: '0.0.0.0', port: config.port }).catch((err) => {
  logger.error(err);
  process.exit(1);
});
