import { ImapFlow } from 'imapflow';

export type SharedInboxMessage = {
  uid: number;
  seq: number;
  from: { name?: string; address: string } | null;
  to: Array<{ name?: string; address: string }>;
  subject: string;
  date: string | null;
};

export type ImapCredentials = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

type ImapAddress = {
  name?: string;
  address?: string;
};

function normalizeAddress(a: ImapAddress | undefined): { name?: string; address: string } | null {
  if (!a || !a.address) return null;
  const out: { name?: string; address: string } = { address: a.address };
  if (a.name) out.name = a.name;
  return out;
}

function normalizeAddresses(
  arr: ImapAddress[] | undefined | null,
): Array<{ name?: string; address: string }> {
  if (!arr) return [];
  const out: Array<{ name?: string; address: string }> = [];
  for (const a of arr) {
    const n = normalizeAddress(a);
    if (n) out.push(n);
  }
  return out;
}

/**
 * Connect to an IMAP server with the given credentials and fetch the last
 * `limit` messages in INBOX (by sequence number), newest first.
 *
 * Returns envelope-level data only (no bodies) — keeps the payload small
 * and avoids fetching attachments.
 */
export async function fetchSharedInboxMessages(
  creds: ImapCredentials,
  limit = 20,
): Promise<SharedInboxMessage[]> {
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');

  try {
    const status = await client.status('INBOX', { messages: true });
    const total = status.messages ?? 0;
    if (total === 0) return [];

    const startSeq = Math.max(1, total - limit + 1);
    const range = `${startSeq}:${total}`;

    const messages: SharedInboxMessage[] = [];
    for await (const msg of client.fetch(range, {
      envelope: true,
      uid: true,
      internalDate: true,
    })) {
      const env = msg.envelope;
      messages.push({
        uid: msg.uid ?? 0,
        seq: msg.seq,
        from: normalizeAddress(env?.from?.[0]),
        to: normalizeAddresses(env?.to ?? null),
        subject: env?.subject ?? '',
        date: env?.date
          ? new Date(env.date).toISOString()
          : msg.internalDate
            ? new Date(msg.internalDate).toISOString()
            : null,
      });
    }

    messages.sort((a, b) => b.seq - a.seq);
    return messages;
  } finally {
    lock.release();
    await client.logout().catch(() => {
      // ignore logout errors — we already have what we need
    });
  }
}
