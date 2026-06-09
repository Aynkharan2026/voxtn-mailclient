import { cookies } from "next/headers";
import {
  listInboxAction,
  getMessageAction,
  replyDraftAction,
  replyAllAction,
  forwardAction,
  flagAction,
  labelAction,
  getThreadAction,
  archiveAction,
  deleteAction,
  markReadAction,
} from "./actions";
import { triageMessagesAction } from "./triage-actions";
import { InboxView } from "@/components/inbox/InboxView";
import { summarizeThreadAction, semanticSearchAction } from "@/lib/actions/ai-intel";
import { canMutate } from "@/lib/permissions";

export const dynamic = "force-dynamic";

// D3: read active account from searchParams.account ?? voxmail_account cookie ?? default
export default async function InboxPage({
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

  const result = await listInboxAction(activeAccount);

  if (!result.ok) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-4">
        <h1 className="text-2xl font-semibold text-brand-navy">Inbox</h1>
        {activeAccount && (
          <p className="text-xs text-gray-400">{activeAccount}</p>
        )}
        <p className="text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3 max-w-lg text-sm">
          Could not load inbox: {result.error}
        </p>
      </div>
    );
  }

  let triageMap: Record<
    string,
    { priority: "red" | "gold" | "normal"; sentiment: string; stop_request: boolean }
  > = {};
  try {
    triageMap = await triageMessagesAction(result.messages);
  } catch {
    // triage failure must not break inbox render
  }

  // Group 6: determine read-only mode (RBAC gate — server-side)
  const mutateAllowed = await canMutate();

  return (
    <InboxView
      initialMessages={result.messages}
      getMessageAction={getMessageAction}
      replyDraftAction={replyDraftAction}
      replyAllAction={replyAllAction}
      forwardAction={forwardAction}
      flagAction={flagAction}
      labelAction={labelAction}
      getThreadAction={getThreadAction}
      archiveAction={archiveAction}
      deleteAction={deleteAction}
      markReadAction={markReadAction}
      summarizeThreadAction={summarizeThreadAction}
      semanticSearchAction={semanticSearchAction}
      triage={triageMap}
      activeAccount={activeAccount}
      readOnly={!mutateAllowed}
    />
  );
}
