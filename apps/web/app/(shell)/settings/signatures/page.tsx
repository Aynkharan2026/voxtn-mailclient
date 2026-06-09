import { listSignaturesAction } from "./actions";
import { SignatureManager } from "@/components/signatures/SignatureManager";

export const dynamic = "force-dynamic";

export default async function SignaturesPage() {
  const res = await listSignaturesAction();
  const initial = res.ok ? res.signatures : [];
  const loadError = res.ok ? null : res.error;

  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-brand-navy mb-6">
        Signatures
      </h1>
      {loadError && (
        <div className="text-sm text-red-700 mb-4">
          Couldn&apos;t load signatures: {loadError}
        </div>
      )}
      <SignatureManager initial={initial} />
    </main>
  );
}
