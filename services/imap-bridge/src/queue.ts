import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { createTransport } from 'nodemailer';
import pino from 'pino';

import { config } from './config.js';
import { pool } from './db.js';

const logger = pino({ level: config.logLevel, name: 'voxmail-imap.worker' });

// --------------------------------------------------------------------------
// Shared Redis connection
// --------------------------------------------------------------------------

const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

// --------------------------------------------------------------------------
// /send queue (interactive, 10-second undo delay, no rate limit)
// --------------------------------------------------------------------------

export const QUEUE_NAME = 'voxmail.outbound.send';
export const UNDO_DELAY_MS = 10_000;

export type SendJobMessage = {
  messageId: string;
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
};

export type SendJobData = {
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  message: SendJobMessage;
};

export const sendQueue = new Queue<SendJobData>(QUEUE_NAME, { connection });

export function startSendWorker(): Worker<SendJobData> {
  const worker = new Worker<SendJobData>(
    QUEUE_NAME,
    async (job: Job<SendJobData>) => {
      const { smtp, message } = job.data;
      const transport = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.pass },
      });
      try {
        const info = await transport.sendMail({
          messageId: `<${message.messageId}>`,
          from: message.from,
          to: message.to,
          cc: message.cc,
          bcc: message.bcc,
          subject: message.subject,
          html: message.html,
        });
        logger.info(
          { jobId: job.id, messageId: info.messageId, accepted: info.accepted },
          'email sent',
        );
        return { messageId: info.messageId };
      } finally {
        transport.close();
      }
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'send job failed');
  });

  return worker;
}

// --------------------------------------------------------------------------
// /campaigns queue (mass-send, rate-limited at 10/min, serial)
// --------------------------------------------------------------------------

export const CAMPAIGN_QUEUE_NAME = 'voxmail.outbound.campaign';
export const CAMPAIGN_RATE_MAX = 10;
export const CAMPAIGN_RATE_DURATION_MS = 60_000;

export type CampaignJobData = {
  campaignId: string;
  recipientId: string;
  smtp: SendJobData['smtp'];
  message: SendJobMessage;
};

export const campaignQueue = new Queue<CampaignJobData>(
  CAMPAIGN_QUEUE_NAME,
  { connection },
);

export function startCampaignWorker(): Worker<CampaignJobData> {
  const worker = new Worker<CampaignJobData>(
    CAMPAIGN_QUEUE_NAME,
    async (job: Job<CampaignJobData>) => {
      const { smtp, message, recipientId } = job.data;

      await pool.query(
        "UPDATE campaign_recipients SET status = 'sending' WHERE id = $1",
        [recipientId],
      );

      const transport = createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.pass },
      });

      try {
        const info = await transport.sendMail({
          messageId: `<${message.messageId}>`,
          from: message.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
        });
        await pool.query(
          `UPDATE campaign_recipients
              SET status = 'sent', message_id = $1, sent_at = now(), error = NULL
            WHERE id = $2`,
          [info.messageId ?? message.messageId, recipientId],
        );
        logger.info(
          { jobId: job.id, recipientId, to: message.to },
          'campaign email sent',
        );
        return { messageId: info.messageId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await pool.query(
          "UPDATE campaign_recipients SET status = 'failed', error = $1 WHERE id = $2",
          [msg, recipientId],
        );
        throw err;
      } finally {
        transport.close();
      }
    },
    {
      connection,
      concurrency: 1,
      limiter: {
        max: CAMPAIGN_RATE_MAX,
        duration: CAMPAIGN_RATE_DURATION_MS,
      },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, recipientId: job?.data?.recipientId, err: err.message },
      'campaign send job failed',
    );
  });

  return worker;
}
