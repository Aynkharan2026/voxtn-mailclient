"use server";

export type CampaignResult =
  | { ok: true; campaignId: string; queued: number }
  | { ok: false; error: string };

export async function sendCampaignAction(payload: {
  subject: string;
  html: string;
  recipients: string[];
}): Promise<CampaignResult> {
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
    return { ok: false, error: "DEV_SMTP_* not configured in apps/web/.env.local" };
  }

  const recipients = payload.recipients
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (recipients.length === 0) {
    return { ok: false, error: "no recipients" };
  }

  try {
    const res = await fetch(`${base}/campaigns`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: payload.subject,
        html: payload.html,
        recipients,
        smtp,
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `voxmail-imap ${res.status}: ${detail}` };
    }
    const data = (await res.json()) as { campaignId: string; queued: number };
    return { ok: true, campaignId: data.campaignId, queued: data.queued };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
