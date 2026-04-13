import { createHmac, timingSafeEqual } from 'node:crypto';

import { config } from './config.js';

/**
 * Unsubscribe token format:
 *   <base64url(JSON({r,s}))>.<base64url(hmac-sha256 over that JSON)>
 *
 *   r = recipient email (lowercased)
 *   s = sender email    (campaign owner, lowercased)
 *
 * The token itself carries attribution so the unsubscribe endpoint can
 * credit the right campaign owner in the audit log without needing a
 * per-token DB row.
 */

type TokenPayload = { r: string; s: string };

export function signUnsubscribeToken(recipient: string, sender: string): string {
  if (!config.unsubscribeSecret) {
    throw new Error('UNSUBSCRIBE_SECRET not configured');
  }
  const payload: TokenPayload = {
    r: recipient.trim().toLowerCase(),
    s: sender.trim().toLowerCase(),
  };
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf-8').toString('base64url');
  const sig = createHmac('sha256', config.unsubscribeSecret)
    .update(b64)
    .digest('base64url');
  return `${b64}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): TokenPayload | null {
  if (!config.unsubscribeSecret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts as [string, string];
  const expected = createHmac('sha256', config.unsubscribeSecret)
    .update(b64)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf-8');
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('r' in parsed) ||
      !('s' in parsed)
    ) {
      return null;
    }
    const { r, s } = parsed as { r: unknown; s: unknown };
    if (typeof r !== 'string' || typeof s !== 'string') return null;
    return { r: r.toLowerCase(), s: s.toLowerCase() };
  } catch {
    return null;
  }
}

export function unsubscribeFooterHtml(token: string): string {
  const url = `${config.unsubscribeBaseUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
  // Literal HTML per Phase 5 Step 2 spec. Inline styles only — email
  // clients strip <style> blocks.
  return (
    '<p style="font-size:11px;color:#999;">' +
    'To unsubscribe, <a href="' +
    url +
    '">click here</a>.</p>'
  );
}

export function appendUnsubscribeFooter(
  bodyHtml: string,
  token: string,
): string {
  return bodyHtml + unsubscribeFooterHtml(token);
}
