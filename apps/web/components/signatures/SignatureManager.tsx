"use client";

import { useState, useTransition } from "react";
import { Editor } from "@/components/composer/Editor";
import {
  createSignatureAction,
  deleteSignatureAction,
  listSignaturesAction,
  setDefaultSignatureAction,
  type Signature,
} from "@/app/settings/signatures/actions";

export function SignatureManager({ initial }: { initial: Signature[] }) {
  const [signatures, setSignatures] = useState<Signature[]>(initial);
  const [name, setName] = useState("");
  const [html, setHtml] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const refresh = async () => {
    const res = await listSignaturesAction();
    if (res.ok) setSignatures(res.signatures);
  };

  const handleCreate = () => {
    if (!name.trim() || !html.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await createSignatureAction({
        name,
        html_content: html,
        is_default: makeDefault,
      });
      if (res.ok) {
        setName("");
        setHtml("");
        setMakeDefault(false);
        await refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const handleDelete = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await deleteSignatureAction(id);
      if (res.ok) await refresh();
      else setError(res.error);
    });
  };

  const handleSetDefault = (id: string) => {
    setError(null);
    startTransition(async () => {
      const res = await setDefaultSignatureAction(id);
      if (res.ok) await refresh();
      else setError(res.error);
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="text-lg font-semibold mb-2">Your signatures</h2>
        {signatures.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No signatures yet. Create one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {signatures.map((s) => (
              <li key={s.id} className="border rounded p-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-brand-navy">
                      {s.name}
                      {s.is_default && (
                        <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded bg-brand-amber text-brand-navy">
                          default
                        </span>
                      )}
                    </div>
                    <div
                      className="prose prose-sm max-w-none mt-2 text-gray-700"
                      dangerouslySetInnerHTML={{ __html: s.html_content }}
                    />
                  </div>
                  <div className="flex flex-col gap-1 shrink-0 text-sm">
                    {!s.is_default && (
                      <button
                        type="button"
                        onClick={() => handleSetDefault(s.id)}
                        disabled={isPending}
                        className="text-brand-amber hover:underline disabled:opacity-50"
                      >
                        Set default
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(s.id)}
                      disabled={isPending}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">New signature</h2>
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 border-b pb-2">
            <span className="text-sm font-medium text-gray-600 w-16">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Work"
              className="flex-1 outline-none bg-transparent"
            />
          </label>

          <Editor value={html} onChange={setHtml} placeholder="-- " />

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={makeDefault}
              onChange={(e) => setMakeDefault(e.target.checked)}
            />
            Make this my default signature
          </label>

          {error && (
            <div className="text-sm text-red-700">Error: {error}</div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending || !name.trim() || !html.trim()}
              className="px-5 py-2 rounded bg-brand-amber text-brand-navy font-medium hover:opacity-90 transition disabled:opacity-50"
            >
              Save signature
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
