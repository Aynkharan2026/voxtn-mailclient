import { cookies } from "next/headers";
import { BriefingPanel } from "@/components/inbox/BriefingPanel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  return (
    <main className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full p-6">
      <h1 className="text-2xl font-semibold text-brand-navy mb-2">
        Daily Briefing
      </h1>
      {activeAccount && (
        <p className="text-xs text-gray-400 mb-4">{activeAccount}</p>
      )}
      {/* BriefingPanel is a client component — loads inbox + AI digest after render */}
      <BriefingPanel initialMessagesAccount={activeAccount} />
    </main>
  );
}
