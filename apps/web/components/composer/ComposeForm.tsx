"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Editor, type EditorHandle } from "./Editor";
import { MicButton } from "./MicButton";
import {
  cancelSendAction,
  sendEmailAction,
  voiceToEmailAction,
  transformAction,
  followUpAction,
  draftWithAiAction,
  type TransformOp,
} from "@/app/(shell)/compose/actions";

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
  prefillTo,
  prefillCc,
  prefillSubject,
  prefillInReplyTo,
  prefillReferences,
  contactSuggestions = [],
}: {
  initialHtml?: string;
  prefillTo?: string;
  prefillCc?: string;
  prefillSubject?: string;
  prefillInReplyTo?: string;
  prefillReferences?: string;
  /** Recipient autocomplete — email addresses from recent senders */
  contactSuggestions?: string[];
}) {
  const [to, setTo] = useState(prefillTo ?? "");
  const [cc, setCc] = useState(prefillCc ?? "");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(prefillSubject ?? "");
  const [bodyHtml, setBodyHtml] = useState(initialHtml);
  // D4: Hold reply-thread identifiers in hidden state; passed to send
  const [inReplyTo] = useState(prefillInReplyTo);
  const [references] = useState(prefillReferences);
  const [showCcBcc, setShowCcBcc] = useState(!!(prefillCc));
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [isPending, startTransition] = useTransition();

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);
  const [insertingBooking, setInsertingBooking] = useState(false);
  // W2: AI transform state
  const [transformingOp, setTransformingOp] = useState<TransformOp | null>(null);
  const [followingUp, setFollowingUp] = useState(false);
  // E3: AI-draft panel state — three explicit visual states.
  const [aiIntent, setAiIntent] = useState("");
  const [aiDraftState, setAiDraftState] = useState<
    | { state: "idle" }
    | { state: "generating" }
    | { state: "ready" }
    | { state: "error" }
  >({ state: "idle" });

  const handleInsertBookingLink = async () => {
    setInsertingBooking(true);
    try {
      const res = await fetch("/api/cal/booking-url", { cache: "no-store" });
      if (!res.ok) {
        const detail = await res.text();
        setStatus({ state: "error", message: `booking URL: ${res.status} ${detail}` });
        return;
      }
      const { url } = (await res.json()) as { url: string };
      const escapedHref = url.replace(/"/g, "&quot;");
      const style =
        "background:#f59e0b;color:#0d1b2e;padding:8px 16px;border-radius:4px;text-decoration:none;font-weight:600;";
      const html = `<a href="${escapedHref}" style="${style}">📅 Book a time with me</a>`;
      editorRef.current?.insertHtml(html);
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setInsertingBooking(false);
    }
  };

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
        in_reply_to: inReplyTo,
        references: references,
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

  // W2: AI transform — replaces body (or selection) with result
  const handleTransform = async (op: TransformOp) => {
    const text = bodyHtml;
    if (!text.trim()) return;
    setTransformingOp(op);
    try {
      const res = await transformAction(text, op);
      if (res.ok) {
        setBodyHtml(res.result);
      } else {
        setStatus({ state: "error", message: `Transform failed: ${res.error}` });
      }
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTransformingOp(null);
    }
  };

  // W2: Follow-up draft — inserts AI draft into body (never auto-sends)
  const handleFollowUp = async () => {
    setFollowingUp(true);
    try {
      const threadCtx = prefillInReplyTo ?? subject;
      const res = await followUpAction(threadCtx);
      if (res.ok) {
        const base = bodyHtml ? `${res.draft}<p></p>${bodyHtml}` : res.draft;
        setBodyHtml(base);
      } else {
        setStatus({ state: "error", message: `Follow-up failed: ${res.error}` });
      }
    } catch (err) {
      setStatus({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setFollowingUp(false);
    }
  };

  // E3: Draft with AI — inserts the returned draft into the EDITABLE body
  // (same mechanism as follow-up) and NEVER auto-sends. tier label only.
  const handleAiDraft = async () => {
    if (!aiIntent.trim()) return;
    setAiDraftState({ state: "generating" });
    try {
      const res = await draftWithAiAction(aiIntent);
      if (res.ok) {
        const base = bodyHtml ? `${res.draft}<p></p>${bodyHtml}` : res.draft;
        setBodyHtml(base);
        setAiDraftState({ state: "ready" });
      } else {
        setAiDraftState({ state: "error" });
      }
    } catch {
      // Never surface a raw backend error (could carry a model name).
      setAiDraftState({ state: "error" });
    }
  };

  const sendDisabled =
    isPending || status.state === "sending" || status.state === "pending";

  return (
    <div className="flex flex-col gap-4">
      {/* Datalist for recipient autocomplete — derived from recent senders */}
      <datalist id="recipient-options" data-testid="recipient-autocomplete">
        {contactSuggestions.map((email) => (
          <option key={email} value={email} />
        ))}
      </datalist>

      <RecipientRow
        label="To"
        value={to}
        onChange={setTo}
        placeholder="recipient@example.com"
        listId="recipient-options"
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
            listId="recipient-options"
          />
          <RecipientRow
            label="Bcc"
            value={bcc}
            onChange={setBcc}
            placeholder="bcc@example.com"
            listId="recipient-options"
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

      <div className="flex items-center gap-3 flex-wrap">
        <MicButton
          submit={voiceToEmailAction}
          disabled={sendDisabled}
          onError={(msg) => setStatus({ state: "error", message: msg })}
          onTranscribed={({ subject: s, html }) => {
            if (!subject.trim() && s) setSubject(s);
            const base = initialHtml
              ? `${html}<p></p>${initialHtml}`
              : html;
            setBodyHtml(base);
            setStatus({ state: "idle" });
          }}
        />
        <button
          type="button"
          onClick={handleInsertBookingLink}
          disabled={sendDisabled || insertingBooking}
          className="px-3 py-2 rounded border border-gray-300 text-brand-navy hover:bg-gray-50 font-medium disabled:opacity-50 flex items-center gap-2 text-sm"
        >
          <span>📅</span>
          <span>{insertingBooking ? "Inserting…" : "Insert Booking Link"}</span>
        </button>
      </div>

      {/* E3: AI Draft panel — generate an editable draft from a short intent. */}
      <div
        data-testid="ai-draft-panel"
        className="flex flex-col gap-2 border border-gray-200 rounded px-3 py-2.5 bg-gray-50"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-brand-navy flex items-center gap-1">
            <span aria-hidden="true">✨</span> Draft with AI
          </span>
          <span
            data-testid="ai-draft-tier"
            className="text-[11px] font-semibold rounded px-2 py-0.5 bg-amber-50 text-brand-amber border border-brand-amber/40"
          >
            Standard
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            data-testid="ai-draft-intent"
            value={aiIntent}
            onChange={(e) => setAiIntent(e.target.value)}
            placeholder="What should this email say?"
            disabled={sendDisabled || aiDraftState.state === "generating"}
            className="flex-1 min-w-[12rem] rounded border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-amber bg-white disabled:opacity-50"
          />
          <button
            type="button"
            data-testid="ai-draft-generate"
            onClick={handleAiDraft}
            disabled={
              sendDisabled ||
              aiDraftState.state === "generating" ||
              !aiIntent.trim()
            }
            className="px-3 py-1.5 text-sm rounded bg-brand-amber text-brand-navy font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center gap-1.5"
          >
            {aiDraftState.state === "generating" && (
              <span className="w-3 h-3 rounded-full border-2 border-brand-navy border-t-transparent animate-spin inline-block" />
            )}
            Generate
          </button>
        </div>
        {aiDraftState.state !== "idle" && (
          <div data-testid="ai-draft-status" className="text-xs">
            {aiDraftState.state === "generating" && (
              <span className="text-gray-500 flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border-2 border-brand-amber border-t-transparent animate-spin inline-block" />
                Generating draft · Standard…
              </span>
            )}
            {aiDraftState.state === "ready" && (
              <span className="text-green-700">✓ Draft ready · Standard</span>
            )}
            {aiDraftState.state === "error" && (
              <span className="text-red-700">
                Couldn’t generate a draft right now — you can write it manually.
              </span>
            )}
          </div>
        )}
      </div>

      {/* W2: AI transform toolbar */}
      <div className="flex items-center gap-1.5 flex-wrap border border-gray-200 rounded px-2 py-1.5 bg-gray-50">
        <span className="text-xs text-gray-400 mr-1">AI:</span>
        {(
          [
            { op: "elaborate" as TransformOp, label: "Elaborate", testid: "tf-elaborate" },
            { op: "shorten" as TransformOp, label: "Shorten", testid: "tf-shorten" },
            { op: "rephrase" as TransformOp, label: "Rephrase", testid: "tf-rephrase" },
            { op: "formal" as TransformOp, label: "Formal", testid: "tf-formal" },
            { op: "casual" as TransformOp, label: "Casual", testid: "tf-casual" },
            { op: "fix_grammar" as TransformOp, label: "Fix Grammar", testid: "tf-fixgrammar" },
          ] as const
        ).map(({ op, label, testid }) => (
          <button
            key={op}
            type="button"
            data-testid={testid}
            disabled={sendDisabled || transformingOp !== null || followingUp}
            onClick={() => handleTransform(op)}
            className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-600 hover:border-brand-amber hover:text-brand-amber transition disabled:opacity-40 flex items-center gap-1"
          >
            {transformingOp === op && (
              <span className="w-3 h-3 rounded-full border-2 border-brand-amber border-t-transparent animate-spin inline-block" />
            )}
            {label}
          </button>
        ))}
        <button
          type="button"
          data-testid="followup-btn"
          disabled={sendDisabled || transformingOp !== null || followingUp}
          onClick={handleFollowUp}
          className="px-2 py-1 text-xs rounded border border-brand-amber text-brand-amber hover:bg-amber-50 transition disabled:opacity-40 flex items-center gap-1 ml-1"
        >
          {followingUp && (
            <span className="w-3 h-3 rounded-full border-2 border-brand-amber border-t-transparent animate-spin inline-block" />
          )}
          Generate follow-up
        </button>
      </div>

      <Editor ref={editorRef} value={bodyHtml} onChange={setBodyHtml} />

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
  listId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  trailing?: React.ReactNode;
  listId?: string;
}) {
  return (
    <label className="flex items-center gap-3 border-b pb-2">
      <span className="text-sm font-medium text-gray-600 w-16">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={listId}
        className="flex-1 outline-none bg-transparent"
      />
      {trailing}
    </label>
  );
}
