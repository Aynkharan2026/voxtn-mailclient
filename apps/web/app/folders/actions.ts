"use server";

import type { InboxMessage } from "@/app/(shell)/inbox/actions";

export type ListFolderResult =
  | { ok: true; messages: InboxMessage[] }
  | { ok: false; error: string };

export type GetFolderMessageResult =
  | { ok: true; message: InboxMessage }
  | { ok: false; error: string };

const FOLDER_MAP: Record<string, string> = {
  sent: "Sent",
  drafts: "Drafts",
  spam: "Junk",
  trash: "Trash",
  archive: "Archive",
};

// --- in-memory token cache (separate from inbox cache) ---
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;
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
      error:
        "server not configured — set VOXMAIL_MCP_* in apps/web/.env.local",
    };
  }
  return { ok: true, tokenUrl, clientId, clientSecret, audience, mcpUrl };
}

async function mintVoxmailToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedToken && now < tokenExpiresAt) {
    return cachedToken;
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
    scope: "voxmail.read",
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
  cachedToken = data.access_token;
  tokenExpiresAt = now + TOKEN_TTL_MS;
  return cachedToken;
}

async function mcpPost<T>(
  path: string,
  reqBody: Record<string, unknown>,
  retry = true,
): Promise<T> {
  const cfg = getMcpConfig();
  if (!cfg.ok) throw new Error(cfg.error);

  let token = await mintVoxmailToken();

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
    token = await mintVoxmailToken(true);
    res = await doFetch(token);
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`MCP ${path} ${res.status}: ${detail}`);
  }

  return res.json() as Promise<T>;
}

export async function listFolderAction(
  uiFolder: string,
): Promise<ListFolderResult> {
  const cfg = getMcpConfig();
  if (!cfg.ok) return { ok: false, error: cfg.error };

  const imapFolder = FOLDER_MAP[uiFolder];
  if (!imapFolder) {
    return { ok: false, error: `Unknown folder: ${uiFolder}` };
  }

  try {
    const data = await mcpPost<{ messages: InboxMessage[] }>(
      "voxmail_list_unread/call",
      { folder: imapFolder, limit: 50 },
    );
    return { ok: true, messages: data.messages ?? [] };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getFolderMessageAction(
  messageId: string,
  uiFolder: string,
): Promise<GetFolderMessageResult> {
  const cfg = getMcpConfig();
  if (!cfg.ok) return { ok: false, error: cfg.error };

  const imapFolder = FOLDER_MAP[uiFolder];
  if (!imapFolder) {
    return { ok: false, error: `Unknown folder: ${uiFolder}` };
  }

  try {
    const data = await mcpPost<{ message: InboxMessage }>(
      "voxmail_get_message/call",
      { message_id: messageId, folder: imapFolder },
    );
    return { ok: true, message: data.message };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
