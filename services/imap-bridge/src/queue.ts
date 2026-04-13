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
// /campaigns queue (mass-send, rate-limited at 10/min, serial, idempotent)
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

async function finalizeCampaignStatus(campaignId: string): Promise<void> {
  // Once no recipients remain in 'queued', transition 'sending' → terminal:
  //   complete  if at least one was 'sent'
  //   failed    otherwise
  await pool.query(
    `UPDATE campaigns c
        SET status = CASE
          WHEN (SELECT COUNT(*) FROM campaign_recipients
                 WHERE campaign_id = c.id AND status = 'queued') > 0 THEN c.status
          WHEN (SELECT COUNT(*) FROM campaign_recipients
                 WHERE campaign_id = c.id AND status = 'sent') > 0 THEN 'complete'
          ELSE 'failed'
        END
      WHERE c.id = $1 AND c.status = 'sending'`,
    [campaignId],
  );
}

export function startCampaignWorker(): Worker<CampaignJobData> {
  const worker = new Worker<CampaignJobData>(
    CAMPAIGN_QUEUE_NAME,
    async (job: Job<CampaignJobData>) => {
      const { smtp, message, recipientId, campaignId } = job.data;

      // Idempotency guard: if a previous attempt already sent this recipient
      // (e.g. after a worker crash between SMTP ACK and DB update), skip
      // rather than sending a duplicate.
      const prior = await pool.query<{ status: string }>(
        'SELECT status FROM campaign_recipients WHERE id = $1',
        [recipientId],
      );
      if (prior.rows[0]?.status === 'sent') {
        logger.info({ recipientId }, 'recipient already sent — skipping retry');
        return { skipped: true };
      }

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

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE campaign_recipients
                SET status = 'sent', sent_at = now(), error_msg = NULL
              WHERE id = $1 AND status <> 'sent'`,
            [recipientId],
          );
          await client.query(
            'UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = $1',
            [campaignId],
          );
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }

        await finalizeCampaignStatus(campaignId);
        logger.info(
          { jobId: job.id, recipientId, to: message.to },
          'campaign email sent',
        );
        return { messageId: info.messageId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await pool.query(
          `UPDATE campaign_recipients
              SET status = 'failed', error_msg = $1
            WHERE id = $2`,
          [msg, recipientId],
        );
        await finalizeCampaignStatus(campaignId);
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
