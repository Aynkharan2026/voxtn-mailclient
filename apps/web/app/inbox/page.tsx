import { listInboxAction, getMessageAction } from "./actions";
import { triageMessagesAction } from "./triage-actions";
import { InboxView } from "@/components/inbox/InboxView";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const result = await listInboxAction();

  if (!result.ok) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-4">
        <h1 className="text-2xl font-semibold text-brand-navy">Inbox</h1>
        <p className="text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3 max-w-lg text-sm">
          Could not load inbox: {result.error}
        </p>
      </main>
    );
  }

  let triageMap: Record<string, { priority: "red" | "gold" | "normal"; sentiment: string; stop_request: boolean }> = {};
  try {
    triageMap = await triageMessagesAction(result.messages);
  } catch {
    // triage failure must not break inbox render
  }

  return (
    <main className="min-h-screen flex flex-col">
      <InboxView
        initialMessages={result.messages}
        getMessageAction={getMessageAction}
        triage={triageMap}
      />
    </main>
  );
}
