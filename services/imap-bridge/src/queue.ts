import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { createTransport } from 'nodemailer';
import pino from 'pino';

import { config } from './config.js';

const logger = pino({ level: config.logLevel, name: 'voxmail-imap.worker' });

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

const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

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
          {
            jobId: job.id,
            messageId: info.messageId,
            accepted: info.accepted,
            rejected: info.rejected,
          },
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
