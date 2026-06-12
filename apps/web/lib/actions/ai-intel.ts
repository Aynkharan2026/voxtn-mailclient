"use server";

/**
 * lib/actions/ai-intel.ts — Group 2 AI intel server actions.
 * Mirrors the transformAction pattern in apps/web/app/(shell)/compose/actions.ts
 * All AI calls go through AI_BRIDGE_URL + INTERNAL_SERVICE_TOKEN.
 */

export type ThreadMessage = {
  message_id: string;
  from: { name: string; email: string };
  subject: string;
  date: string;
  snippet?: string;
};

export type SummarizeResult =
  | { ok: true; headline: string; bullets: string[] }
  | { ok: false; error: string };

export type BriefingResult =
  | { ok: true; digest: string }
  | { ok: false; error: string };

export type SemanticSearchResult =
  | { ok: true; ranked: string[] } // ordered list of message_ids
  | { ok: false; error: string };

/** Summarize a thread → /ai/summarize-thread */
export async function summarizeThreadAction(
  messages: ThreadMessage[],
): Promise<SummarizeResult> {
  const base = process.env.AI_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    return { ok: false, error: "server not configured" };
  }
  try {
    const res = await fetch(`${base}/ai/summarize-thread`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages }),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `ai-bridge ${res.status}: ${detail}` };
    }
    // ai-bridge returns `one_line` (not `headline`); read the actual field.
    const data = (await res.json()) as { one_line: string; bullets: string[] };
    return { ok: true, headline: data.one_line ?? "", bullets: data.bullets ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Daily briefing → /ai/daily-briefing */
export async function dailyBriefingAction(
  messages: ThreadMessage[],
): Promise<BriefingResult> {
  const base = process.env.AI_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    return { ok: false, error: "server not configured" };
  }
  try {
    const res = await fetch(`${base}/ai/daily-briefing`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages }),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `ai-bridge ${res.status}: ${detail}` };
    }
    const data = (await res.json()) as { digest: string };
    return { ok: true, digest: data.digest ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type SearchCandidate = {
  id: string;
  subject: string;
  snippet?: string;
};

/** Semantic search → /ai/semantic-search */
export async function semanticSearchAction(
  query: string,
  candidates: SearchCandidate[],
): Promise<SemanticSearchResult> {
  const base = process.env.AI_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;
  if (!base || !token) {
    return { ok: false, error: "server not configured" };
  }
  try {
    const res = await fetch(`${base}/ai/semantic-search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, candidates }),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text();
      return { ok: false, error: `ai-bridge ${res.status}: ${detail}` };
    }
    const data = (await res.json()) as { ranked: string[] };
    return { ok: true, ranked: data.ranked ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
