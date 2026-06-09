"use server";

// Shell-level server actions shared across the unified app shell.

// --- MCP helpers (mirrors inbox/actions.ts pattern) ---
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

const tokenCache: Record<string, { token: string; expiresAt: number }> = {};
const TOKEN_TTL_MS = 50 * 60 * 1000;

async function mintToken(
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

  let token = await mintToken(scope);

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
    token = await mintToken(scope, true);
    res = await doFetch(token);
  }

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`MCP ${path} ${res.status}: ${detail}`);
  }

  return res.json() as Promise<T>;
}

export type Account = {
  email_address: string;
  display_name: string;
  provider: string;
  active: boolean;
};

export type ListAccountsResult =
  | { ok: true; accounts: Account[] }
  | { ok: false; error: string; accounts: Account[] };

const DEFAULT_ACCOUNT =
  process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT ?? "mcp@voxtn.com";

// D4: listAccountsAction — mints a read-scoped token, calls voxmail_list_accounts/call.
// Graceful fallback: if the call errors or returns empty, returns at least the default account.
export async function listAccountsAction(): Promise<ListAccountsResult> {
  const fallback: Account[] = [
    {
      email_address: DEFAULT_ACCOUNT,
      display_name: DEFAULT_ACCOUNT,
      provider: "default",
      active: true,
    },
  ];

  const cfg = getMcpConfig();
  if (!cfg.ok) {
    return { ok: false, error: cfg.error, accounts: fallback };
  }

  try {
    const data = await mcpPost<{ accounts: Account[] }>(
      "voxmail_list_accounts/call",
      {},
      "voxmail.read",
    );
    const accounts = data.accounts && data.accounts.length > 0
      ? data.accounts
      : fallback;
    return { ok: true, accounts };
  } catch (err) {
    // Graceful degradation: new MCP tool may not be live yet (404/500)
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      accounts: fallback,
    };
  }
}
