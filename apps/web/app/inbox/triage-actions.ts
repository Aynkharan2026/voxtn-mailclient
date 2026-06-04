"use server";

export type TriageState = {
  priority: "red" | "gold" | "normal";
  sentiment: string;
  stop_request: boolean;
};

type TriageInput = {
  message_id: string;
  subject: string;
  from: { email: string };
  snippet?: string;
};

type TriageApiResponse = {
  priority: "red" | "gold" | "normal";
  sentiment: string;
  stop_request: boolean;
};

export async function triageMessagesAction(
  messages: TriageInput[],
): Promise<Record<string, TriageState>> {
  const base = process.env.AI_BRIDGE_URL;
  const token = process.env.INTERNAL_SERVICE_TOKEN;

  if (!base || !token) {
    return {};
  }

  const results = await Promise.all(
    messages.map(async (msg) => {
      try {
        const res = await fetch(`${base}/triage`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subject: msg.subject,
            body: msg.snippet ?? msg.subject,
            from_email: msg.from.email,
          }),
          cache: "no-store",
        });
        if (!res.ok) {
          return null;
        }
        const data = (await res.json()) as TriageApiResponse;
        const state: TriageState = {
          priority: data.priority ?? "normal",
          sentiment: data.sentiment ?? "neutral",
          stop_request: data.stop_request ?? false,
        };
        return { id: msg.message_id, state };
      } catch {
        return null;
      }
    }),
  );

  const map: Record<string, TriageState> = {};
  for (const entry of results) {
    if (entry !== null) {
      map[entry.id] = entry.state;
    }
  }
  return map;
}
