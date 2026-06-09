"use server";

// D5: send via voxmail_send/call MCP tool (voxmail.write scope); DEV_SMTP_* removed from this path.

import { assertCanMutate } from "@/lib/permissions";

type ComposePayload = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  in_reply_to?: string;
  references?: string;
};

export type SendResult =
  | { ok: true; messageId: string; jobId: string }
  | { ok: false; error: string };

export type CancelResult =
  | { ok: true; jobId: string }
  | { ok: false; error: string; alreadyProcessing?: boolean };

export type VoiceToEmailResult =
  | { ok: true; subject: string; html: string }
  | { ok: false; error: string };

export type TransformOp =
  | "elaborate"
  | "shorten"
  | "rephrase"
  | "formal"
  | "casual"
  | "fix_grammar";

export type TransformResult =
  | { ok: true; result: string }
  | { ok: false; error: string };

export type FollowUpResult =
  | { ok: true; draft: string }
  | { ok: false; error: string };

// --- MCP helpers (mirror inbox/actions.ts pattern) ---
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

let writeToken: string | null = null;
let writeTokenExpiresAt = 0;
const WRITE_TOKEN_TTL_MS = 50 * 60 * 1000;

async function mintWriteToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && writeToken && now < writeTokenExpiresAt) {
    return writeToken;
  }
  const cfg = getMcpConfig();
  if (!cfg.ok) throw new Error(cfg.error);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    audience: cfg.audience,
    scope: "voxmail.write",
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
  writeToken = data.access_token;
  writeTokenExpiresAt = now + WRITE_TOKEN_TTL_MS;
  return writeToken;
}

async function mcpWritePost<T>(
  path: string,
  reqBody: Record<string, unknown>,
  retry = true,
): Promise<T> {
  const cfg = getMcpConfig();
  if (!cfg.ok) throw new Error(cfg.error);

  let token = await mintWriteToken();

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
  if (res.status === 401 && retry) {
    token = await mintWriteToken(true);
    res = await doFetch(token);
  }
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`MCP ${path} ${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

// D5: Send via voxmail_send/call (voxmail.write); no DEV_SMTP_* dependency.
export async function sendEmailAction(
  payload: ComposePayload,
): Promise<SendResult> {
  const guard = await assertCanMutate();
  if (!guard.ok) return guard;
  const cfg = getMcpConfig();
  if (!cfg.ok) return { ok: false, error: cfg.error };

  try {
    const reqBody: Record<string, unknown> = {
      to: payload.to,
      subject: payload.subject,
      body: payload.html,
    };
    if (payload.in_reply_to) reqBody.in_reply_to = payload.in_reply_to;
    if (payload.references) reqBody.references = payload.references;

    const data = await mcpWritePost<{ messageId: string; jobId: string }>(
      "voxmail_send/call",
      reqBody,
    );
    return { ok: true, messageId: data.messageId ?? "", jobId: data.jobId ?? "" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function voiceToEmailAction(
  formData: FormData,
): Promise<VoiceToEmailResult> {
  const base = process.env.AI_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    return { ok: false, error: "server not configured" };
  }
  const audio = formData.get("audio");
  if (!(audio instanceof Blob)) {
    return { ok: false, error: "no audio blob in form data" };
  }
  const upload = new FormData();
  upload.append("audio", audio, "voice.webm");
  try {
    const res = await fetch(`${base}/voice-to-email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: upload,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `voxmail-ai ${res.status}: ${detail}` };
    }
    const data = (await res.json()) as { subject: string; html: string };
    return { ok: true, subject: data.subject, html: data.html };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function cancelSendAction(
  jobId: string,
): Promise<CancelResult> {
  const base = process.env.IMAP_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    return { ok: false, error: "server not configured" };
  }
  try {
    const res = await fetch(
      `${base}/send/cancel?jobId=${encodeURIComponent(jobId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    if (res.status === 409) {
      const detail = await res.text();
      return { ok: false, error: detail, alreadyProcessing: true };
    }
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `voxmail-imap ${res.status}: ${detail}` };
    }
    return { ok: true, jobId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// W2: AI transform — calls ai-bridge /ai/transform; mirrors voiceToEmailAction pattern
export async function transformAction(
  text: string,
  op: TransformOp,
): Promise<TransformResult> {
  const base = process.env.AI_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    return { ok: false, error: "server not configured" };
  }
  try {
    const res = await fetch(`${base}/ai/transform`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, op }),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `voxmail-ai ${res.status}: ${detail}` };
    }
    const data = (await res.json()) as { result: string };
    return { ok: true, result: data.result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// W2: AI follow-up draft — calls ai-bridge /ai/follow-up; mirrors voiceToEmailAction pattern
export async function followUpAction(
  thread: string,
): Promise<FollowUpResult> {
  const base = process.env.AI_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    return { ok: false, error: "server not configured" };
  }
  try {
    const res = await fetch(`${base}/ai/follow-up`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ thread }),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `voxmail-ai ${res.status}: ${detail}` };
    }
    const data = (await res.json()) as { draft: string };
    return { ok: true, draft: data.draft };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
