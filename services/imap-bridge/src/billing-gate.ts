/**
 * Billing feature gate for voxmail-imap. Mirrors the voxmail-ai billing.py
 * policy — opt-in via X-Voxmail-User header (legacy/internal callers are
 * allowed through when no header is present).
 *
 * Feature matrix:
 *   free        → no gated features
 *   starter     → summaries + crm
 *   pro         → everything incl. campaigns
 *   enterprise  → everything
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import { pool } from './db.js';

type Tier = 'free' | 'starter' | 'pro' | 'enterprise';
type Feature = 'voice' | 'campaigns' | 'crm' | 'summaries';

const PLAN_FEATURES: Record<Tier, Set<Feature>> = {
  free: new Set<Feature>(),
  starter: new Set<Feature>(['summaries', 'crm']),
  pro: new Set<Feature>(['voice', 'campaigns', 'crm', 'summaries']),
  enterprise: new Set<Feature>(['voice', 'campaigns', 'crm', 'summaries']),
};

async function getPlanForEmail(email: string): Promise<Tier> {
  const { rows } = await pool.query<{ plan_tier: string }>(
    'SELECT plan_tier FROM billing_usage WHERE owner_email = $1',
    [email.toLowerCase()],
  );
  const t = rows[0]?.plan_tier ?? 'free';
  if (t === 'free' || t === 'starter' || t === 'pro' || t === 'enterprise') {
    return t;
  }
  return 'free';
}

export async function enforceFeature(
  feature: Feature,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const header = request.headers['x-voxmail-user'];
  const headerStr = Array.isArray(header) ? header[0] : header;
  if (!headerStr) return true; // legacy caller — no enforcement

  const email = headerStr.trim().toLowerCase();
  if (!email) return true;

  const plan = await getPlanForEmail(email);
  if (!PLAN_FEATURES[plan].has(feature)) {
    reply.code(402).send({
      error: `feature '${feature}' not available on plan '${plan}'`,
      detail: 'Upgrade at /settings/billing.',
    });
    return false;
  }
  return true;
}
