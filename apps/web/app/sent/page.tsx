import { listFolderAction, getFolderMessageAction } from "@/app/folders/actions";
import { FolderView } from "@/components/inbox/FolderView";

export const dynamic = "force-dynamic";

export default async function SentPage() {
  const result = await listFolderAction("sent");

  if (!result.ok) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-8 gap-4">
        <h1 className="text-2xl font-semibold text-brand-navy">Sent</h1>
        <p className="text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3 max-w-lg text-sm">
          Could not load sent: {result.error}
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col">
      <FolderView
        folder="sent"
        label="Sent"
        initialMessages={result.messages}
        getFolderMessageAction={getFolderMessageAction}
      />
    </main>
  );
}
