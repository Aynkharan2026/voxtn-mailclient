import { ComposeForm } from "@/components/composer/ComposeForm";
import { getDefaultSignatureAction } from "@/app/settings/signatures/actions";

export const dynamic = "force-dynamic";

export default async function ComposePage() {
  const res = await getDefaultSignatureAction();
  const initialHtml =
    res.ok && res.signature
      ? `<p></p><p></p>${res.signature.html_content}`
      : "";

  return (
    <main className="min-h-screen max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-brand-navy mb-6">Compose</h1>
      <ComposeForm initialHtml={initialHtml} />
    </main>
  );
}
