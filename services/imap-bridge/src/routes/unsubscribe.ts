import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { logAudit } from '../audit.js';
import { requireInternalToken } from '../auth.js';
import { pool } from '../db.js';
import { verifyUnsubscribeToken } from '../unsubscribe.js';

/**
 * GET /unsubscribe?token=   — PUBLIC. One-click unsubscribe per RFC 8058.
 * POST /unsubscribe         — authenticated (admin). Adds an email directly.
 */

const htmlPage = (title: string, body: string, status: number): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${title} — VoxMail</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 80px auto; padding: 24px; color: #0d1b2e; }
  h1 { color: #0d1b2e; font-size: 1.5rem; margin: 0 0 12px; }
  p  { line-height: 1.5; }
  .brand { margin-top: 48px; font-size: 11px; color: #999; }
  .amber { color: #f59e0b; font-weight: 600; }
</style>
</head>
<body>
${body}
<p class="brand"><span class="amber">VoxMail</span> — a VoxTN product</p>
</body>
</html>`;

function oneClickRobot(userAgent: string | undefined): boolean {
  // Gmail, Yahoo, Outlook one-click processors UA-sniff. We treat any GET as
  // a deliberate unsubscribe regardless, but this hook is here for future
  // analytics.
  if (!userAgent) return false;
  return /\b(gmail|yahoo|outlook)[-\s]?/i.test(userAgent);
}

const postBodySchema = z.object({
  email: z.string().email(),
  source: z.string().max(60).optional(),
  owner_email: z.string().email().optional(),
});

export const unsubscribeRoutes: FastifyPluginAsync = async (app) => {
  // GET is public — token carries everything the server needs.
  app.get<{ Querystring: { token?: string } }>(
    '/unsubscribe',
    async (request, reply) => {
      const token = request.query.token;
      if (!token) {
        reply.code(400).type('text/html; charset=utf-8');
        return htmlPage(
          'Invalid link',
          '<h1>Invalid unsubscribe link</h1><p>This unsubscribe link is missing the security token.</p>',
          400,
        );
      }
      const payload = verifyUnsubscribeToken(token);
      if (!payload) {
        reply.code(400).type('text/html; charset=utf-8');
        return htmlPage(
          'Invalid link',
          '<h1>Invalid unsubscribe link</h1><p>The security token is not valid. The link may be expired or tampered with.</p>',
          400,
        );
      }

      const ua = request.headers['user-agent'] ?? undefined;
      const ip = request.ip;

      try {
        const { rowCount } = await pool.query(
          `INSERT INTO unsubscribes (email, source)
           VALUES ($1, 'email_link')
           ON CONFLICT (email) DO NOTHING`,
          [payload.r],
        );
        const alreadyUnsubscribed = rowCount === 0;

        // Only write an audit row the first time — avoid noise if the same
        // link is clicked multiple times.
        if (!alreadyUnsubscribed) {
          await logAudit({
            ownerEmail: payload.s,
            action: 'unsubscribe',
            payload: {
              recipient: payload.r,
              source: 'email_link',
              one_click_agent: oneClickRobot(ua),
            },
            ipAddress: ip,
          });
        }

        reply.type('text/html; charset=utf-8');
        return htmlPage(
          alreadyUnsubscribed ? 'Already unsubscribed' : 'Unsubscribed',
          alreadyUnsubscribed
            ? `<h1>You're already unsubscribed</h1><p><strong>${escapeHtml(payload.r)}</strong> was previously removed from this sender's list.</p>`
            : `<h1>You've been unsubscribed</h1><p>We won't send any more marketing emails to <strong>${escapeHtml(payload.r)}</strong> via VoxMail.</p>`,
          200,
        );
      } catch (err) {
        reply.code(500).type('text/html; charset=utf-8');
        return htmlPage(
          'Something went wrong',
          `<h1>Something went wrong</h1><p>We couldn't process your unsubscribe right now. Please try again later.</p>`,
          500,
        );
      }
    },
  );

  // POST requires internal bearer; used by apps/web admin tools and tests.
  app.post(
    '/unsubscribe',
    { preHandler: requireInternalToken },
    async (request, reply) => {
      const parsed = postBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid payload',
          details: parsed.error.format(),
        });
      }
      const email = parsed.data.email.trim().toLowerCase();
      const source = parsed.data.source ?? 'admin';
      const ownerEmail = (parsed.data.owner_email ?? email).toLowerCase();

      const { rowCount } = await pool.query(
        `INSERT INTO unsubscribes (email, source)
         VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING`,
        [email, source],
      );

      if (rowCount && rowCount > 0) {
        await logAudit({
          ownerEmail,
          action: 'unsubscribe_admin',
          payload: { recipient: email, source },
          ipAddress: request.ip,
        });
      }

      return reply.code(201).send({
        email,
        added: rowCount && rowCount > 0 ? true : false,
      });
    },
  );
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
