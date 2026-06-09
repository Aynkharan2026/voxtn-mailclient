"use client";

import { useEffect, useState } from "react";
import {
  dailyBriefingAction,
  type ThreadMessage,
} from "@/lib/actions/ai-intel";
import { listInboxAction } from "@/app/(shell)/inbox/actions";
import type { InboxMessage } from "@/app/(shell)/inbox/actions";

type BriefingState =
  | { status: "loading" }
  | { status: "done"; digest: string }
  | { status: "error"; error: string }
  | { status: "empty" };

export function BriefingPanel({
  initialMessagesAccount,
}: {
  initialMessagesAccount?: string;
}) {
  const [state, setState] = useState<BriefingState>({ status: "loading" });

  const load = async () => {
    setState({ status: "loading" });
    try {
      // Fetch inbox messages client-side (fast MCP call via server action)
      const inboxResult = await listInboxAction(initialMessagesAccount);
      const messages: InboxMessage[] = inboxResult.ok
        ? inboxResult.messages
        : [];

      if (messages.length === 0) {
        setState({ status: "empty" });
        return;
      }

      // Map to ThreadMessage shape for the AI action
      const threadMessages: ThreadMessage[] = messages.map((m) => ({
        message_id: m.message_id,
        from: m.from,
        subject: m.subject,
        date: m.date,
        snippet:
          typeof m.body === "string"
            ? m.body.slice(0, 200)
            : m.body?.text?.slice(0, 200),
      }));

      // AI call — the slow part, now client-side / post-render
      const briefing = await dailyBriefingAction(threadMessages);

      if (briefing.ok) {
        setState({ status: "done", digest: briefing.digest });
      } else {
        setState({ status: "error", error: briefing.error });
      }
    } catch (err) {
      setState({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessagesAccount]);

  if (state.status === "loading") {
    return (
      <div
        data-testid="daily-briefing"
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
      >
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span className="w-4 h-4 rounded-full border-2 border-brand-amber border-t-transparent animate-spin inline-block flex-shrink-0" />
          Generating your briefing…
        </div>
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <div
        data-testid="daily-briefing"
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
      >
        <p className="text-sm text-gray-400">
          No unread messages — inbox is empty.
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        data-testid="daily-briefing"
        className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
      >
        <p className="text-sm text-red-600 mb-4">
          Briefing unavailable — {state.error}
        </p>
        <button
          type="button"
          onClick={load}
          className="px-3 py-1.5 text-sm rounded border border-brand-amber text-brand-amber hover:bg-amber-50 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  // status === "done"
  return (
    <div
      data-testid="daily-briefing"
      className="bg-white rounded-lg shadow-sm border border-gray-200 p-6"
    >
      <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-wrap">
        {state.digest}
      </div>
    </div>
  );
}
