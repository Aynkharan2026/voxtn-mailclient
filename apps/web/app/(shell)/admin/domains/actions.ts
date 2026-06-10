"use server";

import { assertCanMutate } from "@/lib/permissions";
import type { DkimInfo } from "@/lib/dns-records";

// ---- types ----------------------------------------------------------------

/**
 * Mailcow returns full domain objects from voxmail_list_domains.
 * We only need the primitives we actually render.
 */
export interface MailcowDomain {
  domain_name: string;
  domain?: string; // fallback field some versions use
  description?: string;
  active?: number | boolean;
  def_quota_for_mbox?: number;
  max_quota_for_mbox?: number;
  quota_used_in_domain?: number;
  created?: string;
  modified?: string;
}

export type ListDomainsResult =
  | { ok: true; domains: string[] }
  | { ok: false; error: string };

export type OnboardDomainResult =
  | { ok: true; dkim: DkimInfo }
  | { ok: false; error: string };

export type GetDomainRecordsResult =
  | { ok: true; dkim: DkimInfo }
  | { ok: false; error: string };

// ---- MCP helpers (mirrored from inbox/actions.ts) -------------------------

const tokenCache: Record<string, { token: string; expiresAt: number }> = {};
const TOKEN_TTL_MS = 50 * 60 * 1000;

function getMcpConfig():
  | {
      ok: true;
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      audience: string;
      mcpUrl: string;
    }
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
  if (!cfg.ok) throw new Error(cfg.error);

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

// ---- server actions -------------------------------------------------------

/**
 * listDomainsAction — list all hosted domains.
 * Read-only; no RBAC gate required.
 */
export async function listDomainsAction(): Promise<ListDomainsResult> {
  const cfg = getMcpConfig();
  if (!cfg.ok) return { ok: false, error: cfg.error };

  try {
    // Mailcow returns an array of domain objects, not plain strings.
    // We accept both shapes: an object with a `domains` array, or a bare array.
    const data = await mcpPost<{ domains: (MailcowDomain | string)[] } | (MailcowDomain | string)[]>(
      "voxmail_list_domains/call",
      {},
      "voxmail.read",
    );

    const raw: (MailcowDomain | string)[] = Array.isArray(data)
      ? data
      : (data as { domains: (MailcowDomain | string)[] }).domains ?? [];

    // Normalise each element to a plain domain-name string.
    const domains: string[] = raw
      .map((entry) => {
        if (typeof entry === "string") return entry;
        // Mailcow object — prefer domain_name, fall back to domain field.
        return (entry as MailcowDomain).domain_name ?? (entry as MailcowDomain).domain ?? "";
      })
      .filter(Boolean);

    return { ok: true, domains };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * onboardDomainAction — add a domain to Mailcow and generate its DKIM key.
 * Write; gated by assertCanMutate (Group-6 RBAC).
 */
export async function onboardDomainAction(
  domain: string,
): Promise<OnboardDomainResult> {
  const guard = await assertCanMutate();
  if (!guard.ok) return guard;

  try {
    await mcpPost<unknown>(
      "voxmail_add_domain/call",
      { domain },
      "voxmail.write",
    );

    const dkimData = await mcpPost<DkimInfo>(
      "voxmail_generate_dkim/call",
      { domain },
      "voxmail.write",
    );

    return { ok: true, dkim: dkimData };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * getDomainRecordsAction — fetch the DKIM record for a domain.
 * Read-only.
 */
export async function getDomainRecordsAction(
  domain: string,
): Promise<GetDomainRecordsResult> {
  const cfg = getMcpConfig();
  if (!cfg.ok) return { ok: false, error: cfg.error };

  try {
    const data = await mcpPost<DkimInfo>(
      "voxmail_get_dkim/call",
      { domain },
      "voxmail.read",
    );
    return { ok: true, dkim: data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
