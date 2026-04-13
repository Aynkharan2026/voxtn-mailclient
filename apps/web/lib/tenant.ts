import "server-only";

export type TenantConfig = {
  slug: string;
  name: string;
  plan_tier: "free" | "starter" | "pro" | "enterprise";
  primary_color: string;
  logo_url: string | null;
  custom_domain: string | null;
};

type FullTenant = TenantConfig & {
  imap_bridge_url: string;
  ai_bridge_url: string;
  crm_api_url: string | null;
  crm_api_key_hint: string | null;
  clerk_org_id: string | null;
  created_at: string;
  updated_at: string;
  id: string;
};

export const DEFAULT_PRIMARY_COLOR = "#f59e0b";

async function callAi(path: string, init: RequestInit = {}): Promise<Response> {
  const base = process.env.AI_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    throw new Error("AI_BRIDGE_URL / INTERNAL_SERVICE_TOKEN not configured");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${base}${path}`, { ...init, headers, cache: "no-store" });
}

export async function getTenantConfig(
  slug: string,
): Promise<FullTenant | null> {
  try {
    const res = await callAi(`/tenants/${encodeURIComponent(slug)}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as FullTenant;
  } catch {
    return null;
  }
}

export async function listTenants(): Promise<FullTenant[]> {
  const res = await callAi("/tenants");
  if (!res.ok) throw new Error(`list /tenants: ${res.status}`);
  return (await res.json()) as FullTenant[];
}

/**
 * Resolve the tenant that applies to this deployment. MVP:
 *   - NEXT_PUBLIC_TENANT_SLUG env var → that tenant
 *   - absent / failed lookup → null (layout falls back to VoxTN defaults)
 */
export async function getCurrentTenant(): Promise<TenantConfig | null> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG;
  if (!slug) return null;
  const t = await getTenantConfig(slug);
  if (!t) return null;
  return {
    slug: t.slug,
    name: t.name,
    plan_tier: t.plan_tier,
    primary_color: t.primary_color,
    logo_url: t.logo_url,
    custom_domain: t.custom_domain,
  };
}
