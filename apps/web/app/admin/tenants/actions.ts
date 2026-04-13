"use server";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  plan_tier: "free" | "starter" | "pro" | "enterprise";
  clerk_org_id: string | null;
  primary_color: string;
  logo_url: string | null;
  custom_domain: string | null;
  imap_bridge_url: string;
  ai_bridge_url: string;
  crm_api_url: string | null;
  crm_api_key_hint: string | null;
  created_at: string;
  updated_at: string;
};

type ListResult = { ok: true; tenants: Tenant[] } | { ok: false; error: string };
type OneResult = { ok: true; tenant: Tenant } | { ok: false; error: string };

async function callAi(path: string, init: RequestInit = {}): Promise<Response> {
  const base = process.env.AI_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) throw new Error("server not configured");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${base}${path}`, { ...init, headers, cache: "no-store" });
}

export async function listTenantsAction(): Promise<ListResult> {
  try {
    const res = await callAi("/tenants");
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true, tenants: (await res.json()) as Tenant[] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function createTenantAction(payload: {
  slug: string;
  name: string;
  plan_tier: "free" | "starter" | "pro" | "enterprise";
  primary_color?: string;
}): Promise<OneResult> {
  try {
    const res = await callAi("/tenants", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true, tenant: (await res.json()) as Tenant };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function updateTenantBrandingAction(
  slug: string,
  patch: Partial<Pick<Tenant, "primary_color" | "logo_url" | "custom_domain">>,
): Promise<OneResult> {
  try {
    const res = await callAi(`/tenants/${encodeURIComponent(slug)}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true, tenant: (await res.json()) as Tenant };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
