import { pool } from './db.js';

type OptOutEntry = {
  email: string;
  source: string;
  unsubscribed_at: string;
};

/**
 * Check whether an email address is on the global opt-out list.
 * Case-insensitive: email is lowercased before the lookup.
 */
export async function isOptedOut(email: string): Promise<boolean> {
  const { rows } = await pool.query<{ '?column?': number }>(
    'SELECT 1 FROM unsubscribes WHERE email = $1',
    [email.toLowerCase()],
  );
  return rows.length > 0;
}

/**
 * Add an email to the global opt-out list.
 * ON CONFLICT DO NOTHING — idempotent.
 * source encodes the channel/origin, e.g. "email:admin", "sms:user".
 */
export async function optOut(email: string, source: string): Promise<void> {
  await pool.query(
    `INSERT INTO unsubscribes (email, source)
     VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING`,
    [email.toLowerCase(), source],
  );
}

/**
 * List all opted-out addresses (admin visibility).
 */
export async function listOptedOut(limit = 500): Promise<OptOutEntry[]> {
  const { rows } = await pool.query<OptOutEntry>(
    `SELECT email, source, unsubscribed_at::text AS unsubscribed_at
       FROM unsubscribes
      ORDER BY unsubscribed_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}
