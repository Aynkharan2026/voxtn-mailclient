"use server";

export type SharedInbox = {
  id: string;
  tenant_email: string;
  name: string;
  email_address: string;
  assigned_rep_emails: string[];
  supervisor_emails: string[];
  created_at: string;
};

type OkList = { ok: true; inboxes: SharedInbox[] };
type OkOne = { ok: true; inbox: SharedInbox };
type Err = { ok: false; error: string };

function tenantEmail(): string | null {
  // Owner of shared inboxes in the MVP = the dev SMTP user.
  return process.env.DEV_SMTP_USER ?? null;
}

async function callImap(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = process.env.IMAP_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) throw new Error('server not configured');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(`${base}${path}`, { ...init, headers, cache: 'no-store' });
}

export async function listSharedInboxesAction(): Promise<OkList | Err> {
  try {
    const t = tenantEmail();
    if (!t) return { ok: false, error: 'DEV_SMTP_USER not set' };
    const res = await callImap(
      `/shared-inboxes?tenant_email=${encodeURIComponent(t)}`,
    );
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    const data = (await res.json()) as { inboxes: SharedInbox[] };
    return { ok: true, inboxes: data.inboxes };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function createSharedInboxAction(payload: {
  name: string;
  email_address: string;
}): Promise<OkOne | Err> {
  try {
    const t = tenantEmail();
    if (!t) return { ok: false, error: 'DEV_SMTP_USER not set' };
    const res = await callImap('/shared-inboxes', {
      method: 'POST',
      body: JSON.stringify({
        tenant_email: t,
        name: payload.name,
        email_address: payload.email_address,
      }),
    });
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true, inbox: (await res.json()) as SharedInbox };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function assignRepAction(
  id: string,
  email: string,
): Promise<OkOne | Err> {
  try {
    const res = await callImap(
      `/shared-inboxes/${encodeURIComponent(id)}/assign`,
      { method: 'POST', body: JSON.stringify({ email }) },
    );
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true, inbox: (await res.json()) as SharedInbox };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function addSupervisorAction(
  id: string,
  email: string,
): Promise<OkOne | Err> {
  try {
    const res = await callImap(
      `/shared-inboxes/${encodeURIComponent(id)}/supervise`,
      { method: 'POST', body: JSON.stringify({ email }) },
    );
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true, inbox: (await res.json()) as SharedInbox };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
