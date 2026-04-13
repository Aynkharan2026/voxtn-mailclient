"use client";

import { useMemo, useState, useTransition } from "react";
import { Editor } from "@/components/composer/Editor";
import { sendCampaignAction } from "@/app/campaigns/actions";

type Status =
  | { state: "idle" }
  | { state: "confirming" }
  | { state: "sending" }
  | { state: "sent"; campaignId: string; queued: number }
  | { state: "error"; message: string };

function parseRecipients(raw: string): string[] {
  const parts = raw
    .split(/[\s,;]+/)
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r.length > 0);
  return Array.from(new Set(parts));
}

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CampaignForm() {
  const [name, setName] = useState("");
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [isPending, startTransition] = useTransition();

  const parsed = useMemo(
    () => parseRecipients(recipientsRaw),
    [recipientsRaw],
  );
  const invalid = parsed.filter((r) => !SIMPLE_EMAIL.test(r));
  const valid = parsed.filter((r) => SIMPLE_EMAIL.test(r));
  const etaMinutes = Math.max(1, Math.ceil(valid.length / 10));

  const formValid =
    name.trim().length > 0 &&
    subject.trim().length > 0 &&
    html.trim().length > 0 &&
    valid.length > 0 &&
    invalid.length === 0;

  const busy = isPending || status.state === "sending";

  const submit = () => {
    setStatus({ state: "sending" });
    startTransition(async () => {
      const res = await sendCampaignAction({
        name,
        subject,
        html,
        recipients: valid,
      });
      if (res.ok) {
        setStatus({
          state: "sent",
          campaignId: res.campaignId,
          queued: res.queued,
        });
        setName("");
        setRecipientsRaw("");
        setSubject("");
        setHtml("");
      } else {
        setStatus({ state: "error", message: res.error });
      }
    });
  };

  if (status.state === "sent") {
    return (
      <div className="border rounded-lg p-6 bg-green-50">
        <h2 className="text-lg font-semibold text-green-800 mb-1">
          Campaign queued
        </h2>
        <p className="text-sm text-green-900">
          <strong>{status.queued}</strong> email{status.queued === 1 ? "" : "s"}{" "}
          queued at 10/min — expect completion in about{" "}
          {Math.max(1, Math.ceil(status.queued / 10))}
          {" "}minute{Math.ceil(status.queued / 10) === 1 ? "" : "s"}.
        </p>
        <p className="text-xs text-green-900/60 mt-2">
          campaign ID:{" "}
          <code className="font-mono">{status.campaignId}</code>
        </p>
        <button
          type="button"
          onClick={() => setStatus({ state: "idle" })}
          className="mt-4 px-4 py-2 rounded bg-brand-amber text-brand-navy font-medium hover:opacity-90"
        >
          New campaign
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-3 border-b pb-2">
        <span className="text-sm font-medium text-gray-600 w-20">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Internal label, e.g. Q2 listings outreach"
          className="flex-1 outline-none bg-transparent"
          disabled={busy}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-600">
          Recipients
          {valid.length > 0 && (
            <span className="ml-2 text-brand-navy font-normal">
              — {valid.length} valid
              {invalid.length > 0 && (
                <span className="text-red-700 ml-2">
                  · {invalid.length} invalid
                </span>
              )}
              <span className="text-gray-500 ml-2">
                · ~{etaMinutes} min to send
              </span>
            </span>
          )}
        </span>
        <textarea
          value={recipientsRaw}
          onChange={(e) => setRecipientsRaw(e.target.value)}
          placeholder={"one per line\nor comma-separated\nalice@example.com"}
          rows={5}
          disabled={busy}
          className="w-full border rounded-md px-3 py-2 outline-none focus:border-brand-amber font-mono text-sm disabled:opacity-50"
        />
        {invalid.length > 0 && (
          <span className="text-xs text-red-700">
            Unrecognised:{" "}
            <span className="font-mono">{invalid.slice(0, 5).join(", ")}</span>
            {invalid.length > 5 && ` and ${invalid.length - 5} more`}
          </span>
        )}
      </label>

      <label className="flex items-center gap-3 border-b pb-2">
        <span className="text-sm font-medium text-gray-600 w-20">Subject</span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="What recipients see in their inbox"
          className="flex-1 outline-none bg-transparent"
          disabled={busy}
        />
      </label>

      <Editor value={html} onChange={setHtml} placeholder="Campaign body…" />

      {status.state === "error" && (
        <div className="text-sm text-red-700">Error: {status.message}</div>
      )}

      {status.state === "confirming" && (
        <div className="border-2 border-brand-amber rounded-md p-4 bg-amber-50 flex flex-col gap-3">
          <div>
            <p className="text-brand-navy font-semibold">
              Send to {valid.length} recipient{valid.length === 1 ? "" : "s"}?
            </p>
            <p className="text-sm text-gray-700 mt-1">
              This will dispatch individual emails (never BCC) at 10/min.
              Estimated finish: <strong>~{etaMinutes} minute{etaMinutes === 1 ? "" : "s"}</strong>.
              Once queued, only the admin Postgres tools can stop sends in flight.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setStatus({ state: "idle" })}
              className="px-4 py-2 rounded border border-gray-300 text-gray-700 hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              className="px-5 py-2 rounded bg-brand-amber text-brand-navy font-semibold hover:opacity-90"
            >
              Confirm send
            </button>
          </div>
        </div>
      )}

      {status.state !== "confirming" && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setStatus({ state: "confirming" })}
            disabled={!formValid || busy}
            className="px-5 py-2 rounded bg-brand-amber text-brand-navy font-medium hover:opacity-90 transition disabled:opacity-50"
          >
            {busy
              ? "Queueing…"
              : valid.length > 0
                ? `Send campaign to ${valid.length}`
                : "Send campaign"}
          </button>
        </div>
      )}
    </div>
  );
}
