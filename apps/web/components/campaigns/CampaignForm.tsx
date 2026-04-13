"use client";

import { useMemo, useState, useTransition } from "react";
import { Editor } from "@/components/composer/Editor";
import { sendCampaignAction } from "@/app/campaigns/actions";

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; campaignId: string; queued: number }
  | { state: "error"; message: string };

// Split recipients on commas, semicolons, whitespace, or newlines. Trim +
// lowercase + dedupe here so the UI's count matches what the server will
// store after its own dedupe.
function parseRecipients(raw: string): string[] {
  const parts = raw
    .split(/[\s,;]+/)
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r.length > 0);
  return Array.from(new Set(parts));
}

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CampaignForm() {
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [isPending, startTransition] = useTransition();

  const parsedRecipients = useMemo(
    () => parseRecipients(recipientsRaw),
    [recipientsRaw],
  );
  const invalid = parsedRecipients.filter((r) => !SIMPLE_EMAIL.test(r));
  const valid = parsedRecipients.filter((r) => SIMPLE_EMAIL.test(r));
  const etaMinutes = Math.ceil(valid.length / 10);

  const canSubmit =
    !isPending &&
    status.state !== "sending" &&
    valid.length > 0 &&
    invalid.length === 0 &&
    subject.trim().length > 0 &&
    html.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    setStatus({ state: "sending" });
    startTransition(async () => {
      const res = await sendCampaignAction({
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
          queued. Rate limited at 10/min, so expect completion in
          about {Math.ceil(status.queued / 10)}
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
              {valid.length > 0 && (
                <span className="text-gray-500 ml-2">
                  · ~{etaMinutes} min to send
                </span>
              )}
            </span>
          )}
        </span>
        <textarea
          value={recipientsRaw}
          onChange={(e) => setRecipientsRaw(e.target.value)}
          placeholder={"alice@example.com\nbob@example.com, carol@example.com"}
          rows={4}
          className="w-full border rounded-md px-3 py-2 outline-none focus:border-brand-amber font-mono text-sm"
        />
        {invalid.length > 0 && (
          <span className="text-xs text-red-700">
            Unrecognised addresses:{" "}
            <span className="font-mono">{invalid.slice(0, 5).join(", ")}</span>
            {invalid.length > 5 && ` and ${invalid.length - 5} more`}
          </span>
        )}
      </label>

      <label className="flex items-center gap-3 border-b pb-2">
        <span className="text-sm font-medium text-gray-600 w-16">Subject</span>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="(no subject)"
          className="flex-1 outline-none bg-transparent"
        />
      </label>

      <Editor value={html} onChange={setHtml} placeholder="Campaign body…" />

      {status.state === "error" && (
        <div className="text-sm text-red-700">Error: {status.message}</div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-5 py-2 rounded bg-brand-amber text-brand-navy font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {status.state === "sending"
            ? "Queueing…"
            : `Queue ${valid.length > 0 ? valid.length : ""} send${valid.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
