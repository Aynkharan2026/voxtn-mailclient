import { listSharedInboxesAction } from "./actions";
import { SharedInboxManager } from "@/components/shared-inboxes/SharedInboxManager";

export const dynamic = "force-dynamic";

export default async function SharedInboxesPage() {
  const res = await listSharedInboxesAction();
  const initial = res.ok ? res.inboxes : [];
  const loadError = res.ok ? null : res.error;

  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-brand-navy mb-2">
        Shared inboxes
      </h1>
      <p className="text-sm text-gray-600 mb-6">
        A shared inbox (e.g. support@acme.com) can be worked by any rep you
        assign, and monitored by supervisors. Fetches and access are recorded
        in the audit log.
      </p>
      {loadError && (
        <div className="text-sm text-red-700 mb-4">
          Couldn&apos;t load shared inboxes: {loadError}
        </div>
      )}
      <SharedInboxManager initial={initial} />
    </main>
  );
}
