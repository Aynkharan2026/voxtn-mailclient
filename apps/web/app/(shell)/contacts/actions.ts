"use server";

// E2: Contact timeline — read-only MCP path (voxmail.read). Mirrors inbox/actions.ts mint+call.

export type ContactDirection = "sent" | "received";

export type ContactEntry = {
  message_id: string;
  from: { name: string; email: string };
  subject: string;
  date: string;
  snippet: string;
  thread_id: string;
  direction: ContactDirection;
  folder: string;
};

export type ContactMessage = {
  message_id: string;
  from: { name: string; email: string };
  subject: string;
  date: string;
  body?: { text?: string; html?: string } | string;
};

export type ContactTimelineResult =
  | { ok: true; entries: ContactEntry[] }
  | { ok: false; error: string };

export type ContactMessageResult =
  | { ok: true; message: ContactMessage }
  | { ok: false; error: string };

// --- MCP helpers (mirror inbox/actions.ts pattern) ---
const tokenCache: Record<string, { token: string; expiresAt: number }> = {};
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minutes

function getMcpConfig():
  | { ok: true; tokenUrl: string; clientId: string; clientSecret: string; audience: string; mcpUrl: string }
  | { ok: false; error: string } {
  const tokenUrl = process.env.VOXMAIL_MCP_TOKEN_URL;
  const clientId = process.env.VOXMAIL_MCP_CLIENT_ID;
  const clientSecret = process.env.VOXMAIL_MCP_CLIENT_SECRET;
  const audience = process.env.VOXMAIL_MCP_AUDIENCE;
  const mcpUrl = process.env.VOXMAIL_MCP_URL;

  if (!tokenUrl || !clientId || !clientSecret || !audience || !mcpUrl) {
    return {
      ok: false,
      error: "server not configured — set VOXMAIL_MCP_* in apps/web/.env.local",
    };
  }
  return { ok: true, tokenUrl, clientId, clientSecret, audience, mcpUrl };
}

async function mintVoxmailToken(
  scope: "voxmail.read" | "voxmail.write" = "voxmail.read",
  forceRefresh = false,
): Promise<string> {
  const now = Date.now();
  const cached = tokenCache[scope];
  if (!forceRefresh && cached && now < cached.expiresAt) {
    return cached.token;
  }

  const cfg = getMcpConfig();
  if (!cfg.ok) {
    throw new Error(cfg.error);
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    audience: cfg.audience,
    scope,
  });

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`token endpoint ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as { access_token: string };
  tokenCache[scope] = { token: data.access_token, expiresAt: now + TOKEN_TTL_MS };
  return data.access_token;
}

async function mcpPost<T>(
  path: string,
  reqBody: Record<string, unknown>,
  scope: "voxmail.read" | "voxmail.write" = "voxmail.read",
  retry = true,
): Promise<T> {
  const cfg = getMcpConfig();
  if (!cfg.ok) throw new Error(cfg.error);

  let token = await mintVoxmailToken(scope);

  const doFetch = async (t: string) =>
    fetch(`${cfg.mcpUrl}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
      cache: "no-store",
    });

  let res = await doFetch(token);

  // Re-mint on 401 once
  if (res.status === 401 && retry) {
    token = await mintVoxmailToken(scope, true);
    res = await doFetch(token);
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`MCP ${path} ${res.status}: ${detail}`);
  }

  return res.json() as Promise<T>;
}

// E2: Contact timeline — voxmail_search_contact (newest-first), read scope.
export async function contactTimelineAction(
  contact: string,
  account?: string,
): Promise<ContactTimelineResult> {
  const cfg = getMcpConfig();
  if (!cfg.ok) return { ok: false, error: cfg.error };

  if (!contact || !contact.trim()) {
    return { ok: false, error: "no contact specified" };
  }

  try {
    const reqBody: Record<string, unknown> = { contact, limit: 50 };
    if (account) reqBody.account = account;
    const data = await mcpPost<{ entries: ContactEntry[] }>(
      "voxmail_search_contact/call",
      reqBody,
      "voxmail.read",
    );
    return { ok: true, entries: data.entries ?? [] };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// E2: Full message for a timeline row — reuse voxmail_get_message; folder must be
// passed so Sent/Archive messages resolve.
export async function contactMessageAction(
  messageId: string,
  folder?: string,
  account?: string,
): Promise<ContactMessageResult> {
  const cfg = getMcpConfig();
  if (!cfg.ok) return { ok: false, error: cfg.error };

  try {
    const reqBody: Record<string, unknown> = { message_id: messageId };
    if (folder) reqBody.folder = folder;
    if (account) reqBody.account = account;
    const data = await mcpPost<{ message: ContactMessage }>(
      "voxmail_get_message/call",
      reqBody,
      "voxmail.read",
    );
    return { ok: true, message: data.message };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
