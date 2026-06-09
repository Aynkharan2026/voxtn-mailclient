import { cookies } from "next/headers";
import { listInboxAction } from "@/app/(shell)/inbox/actions";
import { dailyBriefingAction } from "@/lib/actions/ai-intel";
import type { InboxMessage } from "@/app/(shell)/inbox/actions";

export const dynamic = "force-dynamic";

export default async function BriefingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const urlAccount =
    typeof params.account === "string" ? params.account : undefined;
  const cookieAccount = cookieStore.get("voxmail_account")?.value;
  const activeAccount =
    urlAccount ??
    cookieAccount ??
    process.env.NEXT_PUBLIC_DEFAULT_ACCOUNT ??
    undefined;

  // Load inbox via MCP (read scope — same as InboxPage)
  const inboxResult = await listInboxAction(activeAccount);

  const messages: InboxMessage[] = inboxResult.ok ? inboxResult.messages : [];

  // Map to ThreadMessage shape for the AI action
  const threadMessages = messages.map((m) => ({
    message_id: m.message_id,
    from: m.from,
    subject: m.subject,
    date: m.date,
    snippet:
      typeof m.body === "string"
        ? m.body.slice(0, 200)
        : m.body?.text?.slice(0, 200),
  }));

  let briefing: { ok: true; digest: string } | { ok: false; error: string } = {
    ok: false,
    error: "No messages loaded",
  };

  if (messages.length > 0) {
    briefing = await dailyBriefingAction(threadMessages);
  }

  return (
    <main className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full p-6">
      <h1 className="text-2xl font-semibold text-brand-navy mb-2">
        Daily Briefing
      </h1>
      {activeAccount && (
        <p className="text-xs text-gray-400 mb-4">{activeAccount}</p>
      )}

      {!inboxResult.ok && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3 mb-4">
          Could not load inbox: {inboxResult.error}
        </p>
      )}

      {briefing.ok ? (
        <div
          data-testid="daily-briefing"
          className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
        >
          <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-wrap">
            {briefing.digest}
          </div>
        </div>
      ) : (
        <div
          data-testid="daily-briefing"
          className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
        >
          {messages.length === 0 ? (
            <p className="text-sm text-gray-400">
              No unread messages — inbox is empty.
            </p>
          ) : (
            <p className="text-sm text-red-600">
              Briefing unavailable: {briefing.error}
            </p>
          )}
          {/* Fallback: list subjects when AI is unavailable */}
          {messages.length > 0 && (
            <ul className="mt-4 space-y-1">
              {messages.slice(0, 10).map((m) => (
                <li key={m.message_id} className="text-sm text-gray-700">
                  <span className="font-medium">{m.from.name || m.from.email}</span>
                  {" — "}
                  {m.subject}
                </li>
              ))}
              {messages.length > 10 && (
                <li className="text-xs text-gray-400">
                  +{messages.length - 10} more…
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
