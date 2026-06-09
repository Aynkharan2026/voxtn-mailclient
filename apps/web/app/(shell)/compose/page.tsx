import { ComposeForm } from "@/components/composer/ComposeForm";
import { getDefaultSignatureAction } from "@/app/(shell)/settings/signatures/actions";

export const dynamic = "force-dynamic";

// D4: Accept reply prefill from searchParams (set by inbox reply action)
export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const res = await getDefaultSignatureAction();
  const sigHtml =
    res.ok && res.signature
      ? `<p></p><p></p>${res.signature.html_content}`
      : "";

  // Extract prefill values from searchParams (all optional)
  const prefillTo = typeof params.to === "string" ? params.to : undefined;
  const prefillSubject = typeof params.subject === "string" ? params.subject : undefined;
  const prefillBody = typeof params.body === "string" ? params.body : undefined;
  const prefillInReplyTo = typeof params.in_reply_to === "string" ? params.in_reply_to : undefined;
  const prefillReferences = typeof params.references === "string" ? params.references : undefined;
  const prefillCc = typeof params.cc === "string" ? params.cc : undefined;

  // When replying, place the quoted body before the signature
  const initialHtml = prefillBody
    ? `<p></p>${prefillBody}${sigHtml}`
    : sigHtml;

  return (
    <main className="flex-1 overflow-y-auto max-w-3xl mx-auto w-full p-6">
      <h1 className="text-2xl font-semibold text-brand-navy mb-6">Compose</h1>
      <ComposeForm
        initialHtml={initialHtml}
        prefillTo={prefillTo}
        prefillCc={prefillCc}
        prefillSubject={prefillSubject}
        prefillInReplyTo={prefillInReplyTo}
        prefillReferences={prefillReferences}
      />
    </main>
  );
}
