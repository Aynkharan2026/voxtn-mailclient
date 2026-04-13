"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Editor } from "./Editor";
import { cancelSendAction, sendEmailAction } from "@/app/compose/actions";

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "pending"; jobId: string; secondsLeft: number }
  | { state: "sent" }
  | { state: "unsent" }
  | { state: "error"; message: string };

const UNDO_WINDOW_SECONDS = 10;
const AUTO_DISMISS_MS = 3000;

export function ComposeForm({
  initialHtml = "",
}: {
  initialHtml?: string;
}) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState(initialHtml);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [isPending, startTransition] = useTransition();

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (dismissRef.current) {
      clearTimeout(dismissRef.current);
      dismissRef.current = null;
    }
  };

  useEffect(() => () => clearTimers(), []);

  const clearForm = () => {
    setTo("");
    setCc("");
    setBcc("");
    setSubject("");
    setBodyHtml(initialHtml);
  };

  const scheduleDismiss = () => {
    dismissRef.current = setTimeout(
      () => setStatus({ state: "idle" }),
      AUTO_DISMISS_MS,
    );
  };

  const handleSend = () => {
    if (!to.trim()) {
      setStatus({ state: "error", message: "Add at least one recipient" });
      return;
    }
    clearTimers();
    setStatus({ state: "sending" });
    startTransition(async () => {
      const res = await sendEmailAction({
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        html: bodyHtml,
      });
      if (!res.ok) {
        setStatus({ state: "error", message: res.error });
        return;
      }
      clearForm();
      const { jobId } = res;
      setStatus({ state: "pending", jobId, secondsLeft: UNDO_WINDOW_SECONDS });
      intervalRef.current = setInterval(() => {
        setStatus((prev) =>
          prev.state === "pending"
            ? { ...prev, secondsLeft: Math.max(0, prev.secondsLeft - 1) }
            : prev,
        );
      }, 1000);
      timeoutRef.current = setTimeout(() => {
        clearTimers();
        setStatus({ state: "sent" });
        scheduleDismiss();
      }, UNDO_WINDOW_SECONDS * 1000);
    });
  };

  const handleUndo = () => {
    if (status.state !== "pending") return;
    const jobId = status.jobId;
    clearTimers();
    setStatus({ state: "sending" });
    startTransition(async () => {
      const res = await cancelSendAction(jobId);
      if (res.ok) {
        setStatus({ state: "unsent" });
      } else if (res.alreadyProcessing) {
        // Raced the server — the mail has gone. Show sent instead of error.
        setStatus({ state: "sent" });
      } else {
        setStatus({ state: "error", message: res.error });
        return;
      }
      scheduleDismiss();
    });
  };

  const handleDiscard = () => {
    clearTimers();
    clearForm();
    setStatus({ state: "idle" });
  };

  const sendDisabled =
    isPending || status.state === "sending" || status.state === "pending";

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

      {status.state === "error" && (
        <div className="text-sm text-red-700">Error: {status.message}</div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={handleDiscard}
          disabled={sendDisabled}
          className="px-4 py-2 text-gray-600 hover:text-brand-navy disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={sendDisabled}
          className="px-5 py-2 rounded bg-brand-amber text-brand-navy font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {status.state === "sending" ? "Sending…" : "Send"}
        </button>
      </div>

      <Toast status={status} onUndo={handleUndo} />
    </div>
  );
}

function Toast({
  status,
  onUndo,
}: {
  status: Status;
  onUndo: () => void;
}) {
  if (
    status.state !== "pending" &&
    status.state !== "sent" &&
    status.state !== "unsent"
  ) {
    return null;
  }

  const base =
    "fixed bottom-6 left-1/2 -translate-x-1/2 rounded shadow-lg px-4 py-3 flex items-center gap-4 text-sm z-50";

  if (status.state === "pending") {
    return (
      <div
        className={`${base} bg-brand-navy text-white`}
        role="status"
        aria-live="polite"
      >
        <span>
          Sending in <strong>{status.secondsLeft}s</strong>…
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="text-brand-amber font-semibold hover:underline"
        >
          Undo
        </button>
      </div>
    );
  }

  if (status.state === "sent") {
    return (
      <div className={`${base} bg-green-700 text-white`} role="status">
        Sent ✓
      </div>
    );
  }

  return (
    <div className={`${base} bg-gray-700 text-white`} role="status">
      Message unsent
    </div>
  );
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
