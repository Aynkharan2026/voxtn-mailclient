"use server";

export type Signature = {
  id: string;
  owner_email: string;
  name: string;
  html_content: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

type ListResult =
  | { ok: true; signatures: Signature[] }
  | { ok: false; error: string };
type CreateResult =
  | { ok: true; signature: Signature }
  | { ok: false; error: string };
type DeleteResult = { ok: true; id: string } | { ok: false; error: string };
type SetDefaultResult = CreateResult;
type GetDefaultResult =
  | { ok: true; signature: Signature | null }
  | { ok: false; error: string };

function currentOwnerEmail(): string | null {
  return process.env.DEV_SMTP_USER ?? null;
}

async function callAi(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const base = process.env.AI_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    throw new Error(
      "server not configured — set AI_BRIDGE_URL and INTERNAL_SERVICE_TOKEN in apps/web/.env.local",
    );
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${base}${path}`, { ...init, headers, cache: "no-store" });
}

export async function listSignaturesAction(): Promise<ListResult> {
  try {
    const email = currentOwnerEmail();
    if (!email) return { ok: false, error: "no owner email configured" };
    const res = await callAi(
      `/signatures?email=${encodeURIComponent(email)}`,
    );
    if (!res.ok)
      return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true, signatures: (await res.json()) as Signature[] };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function createSignatureAction(body: {
  name: string;
  html_content: string;
  is_default?: boolean;
}): Promise<CreateResult> {
  try {
    const email = currentOwnerEmail();
    if (!email) return { ok: false, error: "no owner email configured" };
    const res = await callAi("/signatures", {
      method: "POST",
      body: JSON.stringify({
        owner_email: email,
        name: body.name,
        html_content: body.html_content,
        is_default: body.is_default ?? false,
      }),
    });
    if (!res.ok)
      return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true, signature: (await res.json()) as Signature };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function deleteSignatureAction(
  id: string,
): Promise<DeleteResult> {
  try {
    const res = await callAi(`/signatures/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.status === 404) return { ok: false, error: "not found" };
    if (!res.ok)
      return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true, id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function setDefaultSignatureAction(
  id: string,
): Promise<SetDefaultResult> {
  try {
    const res = await callAi(
      `/signatures/${encodeURIComponent(id)}/set-default`,
      { method: "POST" },
    );
    if (!res.ok)
      return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true, signature: (await res.json()) as Signature };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getDefaultSignatureAction(): Promise<GetDefaultResult> {
  const res = await listSignaturesAction();
  if (!res.ok) return { ok: false, error: res.error };
  const def = res.signatures.find((s) => s.is_default) ?? null;
  return { ok: true, signature: def };
}
