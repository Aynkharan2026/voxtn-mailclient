"use server";

type ComposePayload = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
};

export type SendResult =
  | { ok: true; messageId: string; jobId: string }
  | { ok: false; error: string };

export type CancelResult =
  | { ok: true; jobId: string }
  | { ok: false; error: string; alreadyProcessing?: boolean };

export async function sendEmailAction(
  payload: ComposePayload,
): Promise<SendResult> {
  const base = process.env.IMAP_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;

  if (!base || !token) {
    return {
      ok: false,
      error:
        "server not configured — set IMAP_BRIDGE_URL and INTERNAL_SERVICE_TOKEN in apps/web/.env.local",
    };
  }

  const smtp = {
    host: process.env.DEV_SMTP_HOST ?? "",
    port: Number(process.env.DEV_SMTP_PORT ?? 465),
    secure: (process.env.DEV_SMTP_SECURE ?? "true") === "true",
    user: process.env.DEV_SMTP_USER ?? "",
    pass: process.env.DEV_SMTP_PASS ?? "",
  };

  if (!smtp.host || !smtp.user || !smtp.pass) {
    return {
      ok: false,
      error:
        "DEV_SMTP_* not configured in apps/web/.env.local (host/user/pass all required)",
    };
  }

  const body = {
    to: payload.to,
    ...(payload.cc ? { cc: payload.cc } : {}),
    ...(payload.bcc ? { bcc: payload.bcc } : {}),
    subject: payload.subject,
    html: payload.html,
    smtp,
  };

  try {
    const res = await fetch(`${base}/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `voxmail-imap ${res.status}: ${detail}` };
    }
    const data = (await res.json()) as { messageId: string; jobId: string };
    return { ok: true, messageId: data.messageId, jobId: data.jobId };
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
