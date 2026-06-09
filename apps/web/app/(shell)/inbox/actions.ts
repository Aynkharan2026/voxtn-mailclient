"use server";

export type InboxMessage = {
  message_id: string;
  from: { name: string; email: string };
  subject: string;
  date: string;
  body?: { text?: string; html?: string } | string;
};

export type ListInboxResult =
  | { ok: true; messages: InboxMessage[] }
  | { ok: false; error: string };

export type GetMessageResult =
  | { ok: true; message: InboxMessage }
  | { ok: false; error: string };

export type ReplyDraftResult =
  | {
      ok: true;
      to: string;
      cc?: string;
      subject: string;
      in_reply_to: string;
      references?: string;
      quoted_body: string;
      draft_body: string;
    }
  | { ok: false; error: string };

export type MoveResult = { ok: true; moved: true } | { ok: false; error: string };
export type ArchiveResult = MoveResult;
export type DeleteResult = { ok: true; deleted_to_trash: true; trash_folder: string } | { ok: false; error: string };
export type MarkReadResult = { ok: true } | { ok: false; error: string };

// --- in-memory token cache (scoped) ---
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
      error:
        "server not configured — set VOXMAIL_MCP_* in apps/web/.env.local",
    };
  }
  return { ok: true, tokenUrl, clientId, clientSecret, audience, mcpUrl };
}

// D1: parameterized by scope (default voxmail.read)
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

// D3: listInboxAction accepts optional account (email) — threaded from URL/cookie
export async function listInboxAction(account?: string): Promise<ListInboxResult> {
  const cfg = getMcpConfig();
  if (!cfg.ok) return { ok: false, error: cfg.error };

  try {
    const reqBody: Record<string, unknown> = { limit: 50 };
    if (account) reqBody.account = account;
    const data = await mcpPost<{ messages: InboxMessage[] }>(
      "voxmail_list_unread/call",
      reqBody,
      "voxmail.read",
    );
    return { ok: true, messages: data.messages ?? [] };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// D3: getMessageAction accepts optional account
export async function getMessageAction(
  messageId: string,
  account?: string,
): Promise<GetMessageResult> {
  const cfg = getMcpConfig();
  if (!cfg.ok) return { ok: false, error: cfg.error };

  try {
    const reqBody: Record<string, unknown> = { message_id: messageId };
    if (account) reqBody.account = account;
    const data = await mcpPost<{ message: InboxMessage }>(
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

// D2: Reply draft — read scope (prefetch thread context); D3: accept account
export async function replyDraftAction(
  messageId: string,
  account?: string,
): Promise<ReplyDraftResult> {
  try {
    const reqBody: Record<string, unknown> = { message_id: messageId };
    if (account) reqBody.account = account;
    const data = await mcpPost<{
      to: string;
      cc?: string;
      subject: string;
      in_reply_to: string;
      references?: string;
      quoted_body: string;
      draft_body: string;
    }>("voxmail_reply/call", reqBody, "voxmail.read");
    return { ok: true, ...data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// D2: Move — write scope; D3: accept account
export async function moveAction(
  messageId: string,
  destFolder: string,
  account?: string,
): Promise<MoveResult> {
  try {
    const reqBody: Record<string, unknown> = { message_id: messageId, dest_folder: destFolder };
    if (account) reqBody.account = account;
    const data = await mcpPost<{ moved: true }>(
      "voxmail_move/call",
      reqBody,
      "voxmail.write",
    );
    return { ok: true, moved: data.moved };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// D2: Archive = move to Archive; D3: accept account
export async function archiveAction(messageId: string, account?: string): Promise<ArchiveResult> {
  return moveAction(messageId, "Archive", account);
}

// D2: Delete = move to Trash (recoverable); D3: accept account
export async function deleteAction(messageId: string, account?: string): Promise<DeleteResult> {
  try {
    const reqBody: Record<string, unknown> = { message_id: messageId };
    if (account) reqBody.account = account;
    const data = await mcpPost<{ deleted_to_trash: true; trash_folder: string }>(
      "voxmail_delete/call",
      reqBody,
      "voxmail.write",
    );
    return { ok: true, deleted_to_trash: data.deleted_to_trash, trash_folder: data.trash_folder };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// D2: Mark read — write scope; D3: accept account
export async function markReadAction(messageId: string, account?: string): Promise<MarkReadResult> {
  try {
    const reqBody: Record<string, unknown> = { message_id: messageId };
    if (account) reqBody.account = account;
    await mcpPost<unknown>(
      "voxmail_mark_read/call",
      reqBody,
      "voxmail.write",
    );
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
