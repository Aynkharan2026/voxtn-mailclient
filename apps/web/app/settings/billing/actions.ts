"use server";

export type PlanTier = "free" | "starter" | "pro" | "enterprise";

export type Plan = {
  email: string;
  plan_tier: PlanTier;
  mailboxes_used: number;
  ai_calls_this_month: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  period_start: string | null;
  period_end: string | null;
};

type PlanResult = { ok: true; plan: Plan } | { ok: false; error: string };
type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

function ownerEmail(): string | null {
  return process.env.DEV_SMTP_USER ?? null;
}

async function callAi(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
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

export async function getCurrentPlanAction(): Promise<PlanResult> {
  try {
    const email = ownerEmail();
    if (!email) return { ok: false, error: "DEV_SMTP_USER not set" };
    const res = await callAi(`/billing/plan?email=${encodeURIComponent(email)}`);
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    return { ok: true, plan: (await res.json()) as Plan };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function startCheckoutAction(
  tier: "starter" | "pro",
): Promise<CheckoutResult> {
  try {
    const email = ownerEmail();
    if (!email) return { ok: false, error: "DEV_SMTP_USER not set" };
    const res = await callAi("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ email, plan_tier: tier }),
    });
    if (!res.ok) return { ok: false, error: `${res.status}: ${await res.text()}` };
    const data = (await res.json()) as { url: string };
    return { ok: true, url: data.url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
