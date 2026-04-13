import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { createTransport } from 'nodemailer';
import pino from 'pino';

import { logAudit } from './audit.js';
import { config } from './config.js';
import { pool } from './db.js';
import {
  appendUnsubscribeFooter,
  signUnsubscribeToken,
} from './unsubscribe.js';

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
      // DCR-NM-011: STARTTLS on port 587 via the VoxTN Mailcow relay.
      // Transport config comes from env (SMTP_HOST/PORT/USER/PASS); the
      // `smtp` field on the job data is retained only so message.from /
      // audit payloads keep referencing the caller's intended identity,
      // but is no longer used for transport auth.
      const transport = createTransport({
        host: process.env.SMTP_HOST || '208.79.219.189',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: false,
        requireTLS: true,
        tls: { rejectUnauthorized: false },
        auth: {
          user: process.env.SMTP_USER || smtp.user,
          pass: process.env.SMTP_PASS || smtp.pass,
        },
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
// /campaigns queue (mass-send, rate-limited, idempotent, CASL-aware)
// --------------------------------------------------------------------------

export const CAMPAIGN_QUEUE_NAME = 'voxmail.outbound.campaign';
export const CAMPAIGN_RATE_MAX = 10;
export const CAMPAIGN_RATE_DURATION_MS = 60_000;

export type CampaignJobData = {
  campaignId: string;
  recipientId: string;
  smtp: SendJobData['smtp'];
  message: SendJobMessage;
  ownerEmail: string;
};

export const campaignQueue = new Queue<CampaignJobData>(
  CAMPAIGN_QUEUE_NAME,
  { connection },
);

async function finalizeCampaignStatus(campaignId: string): Promise<void> {
  // Allow re-transition between sending/complete/failed as retries finish.
  // Never disturb drafts.
  await pool.query(
    `UPDATE campaigns c
        SET status = CASE
          WHEN (SELECT COUNT(*) FROM campaign_recipients
                 WHERE campaign_id = c.id AND status = 'queued') > 0 THEN c.status
          WHEN (SELECT COUNT(*) FROM campaign_recipients
                 WHERE campaign_id = c.id AND status = 'sent') > 0 THEN 'complete'
          ELSE 'failed'
        END
      WHERE c.id = $1 AND c.status <> 'draft'`,
    [campaignId],
  );
}

export function startCampaignWorker(): Worker<CampaignJobData> {
  const worker = new Worker<CampaignJobData>(
    CAMPAIGN_QUEUE_NAME,
    async (job: Job<CampaignJobData>) => {
      const { smtp, message, recipientId, campaignId, ownerEmail } = job.data;
      const recipientEmail = message.to.toLowerCase();

      // --- idempotency: skip if we already sent this recipient --------------
      const prior = await pool.query<{ status: string }>(
        'SELECT status FROM campaign_recipients WHERE id = $1',
        [recipientId],
      );
      if (prior.rows[0]?.status === 'sent') {
        logger.info({ recipientId }, 'recipient already sent — skipping retry');
        return { skipped: 'already_sent' };
      }

      // --- defense in depth: recheck unsubscribe list ----------------------
      const unsub = await pool.query<{ email: string }>(
        'SELECT email FROM unsubscribes WHERE email = $1',
        [recipientEmail],
      );
      if (unsub.rows.length > 0) {
        await pool.query(
          `UPDATE campaign_recipients
              SET status = 'failed', error_msg = $1
            WHERE id = $2`,
          ['recipient unsubscribed between enqueue and send', recipientId],
        );
        await logAudit({
          ownerEmail,
          action: 'email_failed',
          payload: {
            campaignId,
            to: recipientEmail,
            error: 'recipient unsubscribed between enqueue and send',
          },
          ipAddress: null,
        });
        await finalizeCampaignStatus(campaignId);
        return { skipped: 'unsubscribed_mid_flight' };
      }

      // --- inject unsubscribe footer ---------------------------------------
      const token = signUnsubscribeToken(recipientEmail, ownerEmail);
      const finalHtml = appendUnsubscribeFooter(message.html, token);

      // DCR-NM-011: STARTTLS on port 587 via the VoxTN Mailcow relay.
      // Transport config comes from env (SMTP_HOST/PORT/USER/PASS); the
      // `smtp` field on the job data is retained only so message.from /
      // audit payloads keep referencing the caller's intended identity,
      // but is no longer used for transport auth.
      const transport = createTransport({
        host: process.env.SMTP_HOST || '208.79.219.189',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: false,
        requireTLS: true,
        tls: { rejectUnauthorized: false },
        auth: {
          user: process.env.SMTP_USER || smtp.user,
          pass: process.env.SMTP_PASS || smtp.pass,
        },
      });

      try {
        const info = await transport.sendMail({
          messageId: `<${message.messageId}>`,
          from: message.from,
          to: message.to,
          subject: message.subject,
          html: finalHtml,
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
        await logAudit({
          ownerEmail,
          action: 'email_sent',
          payload: {
            campaignId,
            to: recipientEmail,
            messageId: info.messageId ?? message.messageId,
          },
          ipAddress: null,
        });
        logger.info(
          { jobId: job.id, recipientId, to: recipientEmail },
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
        await logAudit({
          ownerEmail,
          action: 'email_failed',
          payload: {
            campaignId,
            to: recipientEmail,
            error: msg,
          },
          ipAddress: null,
        });
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
