"use client";

import { useState, useTransition } from "react";
import { Editor } from "./Editor";
import { sendEmailAction } from "@/app/compose/actions";

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; jobId: string; messageId: string }
  | { state: "error"; message: string };

export function ComposeForm() {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [isPending, startTransition] = useTransition();

  const handleSend = () => {
    if (!to.trim()) {
      setStatus({ state: "error", message: "Add at least one recipient" });
      return;
    }
    setStatus({ state: "sending" });
    startTransition(async () => {
      const res = await sendEmailAction({
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        html: bodyHtml,
      });
      if (res.ok) {
        setStatus({
          state: "sent",
          jobId: res.jobId,
          messageId: res.messageId,
        });
      } else {
        setStatus({ state: "error", message: res.error });
      }
    });
  };

  const handleDiscard = () => {
    setTo("");
    setCc("");
    setBcc("");
    setSubject("");
    setBodyHtml("");
    setStatus({ state: "idle" });
  };

  const sending = isPending || status.state === "sending";

  return (
    <div className="flex flex-col gap-4">
      <RecipientRow
        label="To"
        value={to}
        onChange={setTo}
        placeholder="recipient@example.com"
        trailing={
          !showCcBcc && (
            <button
              type="button"
              onClick={() => setShowCcBcc(true)}
              className="text-sm text-brand-amber"
            >
              Cc / Bcc
            </button>
          )
        }
      />

      {showCcBcc && (
        <>
          <RecipientRow
            label="Cc"
            value={cc}
            onChange={setCc}
            placeholder="cc@example.com"
          />
          <RecipientRow
            label="Bcc"
            value={bcc}
            onChange={setBcc}
            placeholder="bcc@example.com"
          />
        </>
      )}

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

      <Editor value={bodyHtml} onChange={setBodyHtml} />

      <StatusLine status={status} />

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={handleDiscard}
          disabled={sending}
          className="px-4 py-2 text-gray-600 hover:text-brand-navy disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="px-5 py-2 rounded bg-brand-amber text-brand-navy font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.state === "idle") return null;
  if (status.state === "sending") {
    return <div className="text-sm text-gray-500">Queueing send…</div>;
  }
  if (status.state === "sent") {
    return (
      <div className="text-sm text-green-700">
        Queued. Sends in 10s. job <code className="font-mono">{status.jobId}</code>
      </div>
    );
  }
  return <div className="text-sm text-red-700">Error: {status.message}</div>;
}

function RecipientRow({
  label,
  value,
  onChange,
  placeholder,
  trailing,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  trailing?: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-3 border-b pb-2">
      <span className="text-sm font-medium text-gray-600 w-16">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 outline-none bg-transparent"
      />
      {trailing}
    </label>
  );
}
