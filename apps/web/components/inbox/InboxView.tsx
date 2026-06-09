"use client";

import { useState, useEffect, useTransition, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  InboxMessage,
  GetMessageResult,
  ReplyDraftResult,
  ArchiveResult,
  DeleteResult,
  MarkReadResult,
} from "@/app/inbox/actions";

type Folder = "inbox" | "sent" | "drafts" | "spam" | "trash" | "archive";

const FOLDERS: { key: Folder; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "sent", label: "Sent" },
  { key: "drafts", label: "Drafts" },
  { key: "spam", label: "Spam" },
  { key: "trash", label: "Trash" },
  { key: "archive", label: "Archive" },
];

function formatRelativeDate(dateStr: string, mounted: boolean): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  // Deterministic across server/client: fixed locale + UTC. This is what SSR and the first client render emit.
  const absolute = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (!mounted) return absolute;            // <-- before mount, server and client agree -> no #418
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return absolute;
}

function sanitizeHtml(html: string): string {
  // Strip <script>, <iframe>, and on* event attributes — minimal XSS mitigation.
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\son\w+\s*=[^\s>]*/gi, "");
}

function getBodyText(
  body: InboxMessage["body"],
): { text?: string; html?: string } {
  if (!body) return {};
  if (typeof body === "string") return { text: body };
  return { text: body.text, html: body.html };
}

type TriageState = {
  priority: "red" | "gold" | "normal";
  sentiment: string;
  stop_request: boolean;
};

type ToastMsg = { text: string; variant: "success" | "error" };

export function InboxView({
  initialMessages,
  getMessageAction,
  replyDraftAction,
  archiveAction,
  deleteAction,
  markReadAction,
  triage = {},
}: {
  initialMessages: InboxMessage[];
  getMessageAction: (id: string) => Promise<GetMessageResult>;
  replyDraftAction: (id: string) => Promise<ReplyDraftResult>;
  archiveAction: (id: string) => Promise<ArchiveResult>;
  deleteAction: (id: string) => Promise<DeleteResult>;
  markReadAction: (id: string) => Promise<MarkReadResult>;
  triage?: Record<string, TriageState>;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [activeFolder, setActiveFolder] = useState<Folder>("inbox");
  const [search, setSearch] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<InboxMessage | null>(
    null,
  );
  const [loadedBody, setLoadedBody] = useState<InboxMessage | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Optimistic removal state
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  // Read state tracking (optimistic)
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  // Action busy state
  const [actionPending, setActionPending] = useState(false);
  // Toast
  const [toast, setToast] = useState<ToastMsg | null>(null);
  // Trash confirm dialog
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const showToast = useCallback((text: string, variant: "success" | "error") => {
    setToast({ text, variant });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const filteredMessages = useMemo(() => {
    const q = search.toLowerCase().trim();
    return initialMessages.filter((m) => {
      if (removedIds.has(m.message_id)) return false;
      if (!q) return true;
      return (
        m.from.name.toLowerCase().includes(q) ||
        m.from.email.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q)
      );
    });
  }, [initialMessages, search, removedIds]);

  function handleSelectMessage(msg: InboxMessage) {
    setSelectedMessage(msg);
    setLoadedBody(null);
    setBodyError(null);
    startTransition(async () => {
      const result = await getMessageAction(msg.message_id);
      if (result.ok) {
        setLoadedBody(result.message);
      } else {
        setBodyError(result.error);
      }
    });
  }

  const displayMessage = loadedBody ?? selectedMessage;

  // D3 action handlers
  const handleReply = useCallback(async () => {
    if (!selectedMessage) return;
    setActionPending(true);
    try {
      const draft = await replyDraftAction(selectedMessage.message_id);
      let params: Record<string, string>;
      if (draft.ok) {
        params = {
          to: draft.to,
          subject: draft.subject,
          body: draft.draft_body,
          in_reply_to: draft.in_reply_to,
        };
        if (draft.cc) params.cc = draft.cc;
        if (draft.references) params.references = draft.references;
      } else {
        // Graceful fallback from loaded message data
        const fromEmail = displayMessage?.from.email ?? selectedMessage.from.email;
        const subject = displayMessage?.subject ?? selectedMessage.subject;
        const fallbackSubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;
        params = {
          to: fromEmail,
          subject: fallbackSubject,
          body: "",
          in_reply_to: selectedMessage.message_id,
        };
      }
      const qs = new URLSearchParams(params).toString();
      router.push(`/compose?${qs}`);
    } finally {
      setActionPending(false);
    }
  }, [selectedMessage, displayMessage, replyDraftAction, router]);

  const handleArchive = useCallback(async () => {
    if (!selectedMessage) return;
    setActionPending(true);
    const id = selectedMessage.message_id;
    try {
      const res = await archiveAction(id);
      if (res.ok) {
        setRemovedIds((prev) => new Set(prev).add(id));
        setSelectedMessage(null);
        setLoadedBody(null);
        showToast("Archived", "success");
      } else {
        showToast(`Archive failed: ${res.error}`, "error");
      }
    } finally {
      setActionPending(false);
    }
  }, [selectedMessage, archiveAction, showToast]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDeleteId) return;
    setConfirmDeleteId(null);
    setActionPending(true);
    const id = confirmDeleteId;
    try {
      const res = await deleteAction(id);
      if (res.ok) {
        setRemovedIds((prev) => new Set(prev).add(id));
        setSelectedMessage(null);
        setLoadedBody(null);
        showToast("Moved to Trash", "success");
      } else {
        showToast(`Move to Trash failed: ${res.error}`, "error");
      }
    } finally {
      setActionPending(false);
    }
  }, [confirmDeleteId, deleteAction, showToast]);

  const handleMarkRead = useCallback(async () => {
    if (!selectedMessage) return;
    setActionPending(true);
    const id = selectedMessage.message_id;
    try {
      const res = await markReadAction(id);
      if (res.ok) {
        setReadIds((prev) => new Set(prev).add(id));
        showToast("Marked as read", "success");
      } else {
        showToast(`Mark read failed: ${res.error}`, "error");
      }
    } finally {
      setActionPending(false);
    }
  }, [selectedMessage, markReadAction, showToast]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Folder rail */}
      <aside className="w-48 flex-shrink-0 bg-brand-navy text-white flex flex-col pt-6 pb-4 gap-1">
        <div className="px-4 pb-4 text-lg font-semibold text-brand-amber tracking-tight">
          VoxMail
        </div>
        {FOLDERS.map(({ key, label }) => {
          const isActive = activeFolder === key;
          const isDisabled = key !== "inbox";
          return (
            <button
              key={key}
              disabled={isDisabled}
              onClick={() => !isDisabled && setActiveFolder(key)}
              className={[
                "flex items-center gap-2 px-4 py-2 text-sm rounded-md mx-2 text-left transition",
                isActive
                  ? "bg-brand-amber text-brand-navy font-semibold"
                  : isDisabled
                    ? "text-white/40 cursor-not-allowed"
                    : "text-white/80 hover:bg-white/10",
              ].join(" ")}
            >
              {label}
              {key === "inbox" && initialMessages.length > 0 && (
                <span className="ml-auto bg-brand-amber text-brand-navy text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                  {initialMessages.length}
                </span>
              )}
            </button>
          );
        })}
      </aside>

      {/* Message list */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="p-3 border-b border-gray-100">
          <input
            type="search"
            placeholder="Search inbox…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-amber"
          />
        </div>
        <ul className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {filteredMessages.length === 0 ? (
            <li className="p-4 text-sm text-gray-400 text-center">
              No messages
            </li>
          ) : (
            filteredMessages.map((msg) => {
              const isSelected = selectedMessage?.message_id === msg.message_id;
              return (
                <li key={msg.message_id}>
                  <button
                    onClick={() => handleSelectMessage(msg)}
                    className={[
                      "w-full text-left px-4 py-3 hover:bg-amber-50 transition",
                      isSelected ? "bg-amber-50 border-l-2 border-brand-amber" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-center gap-2">
                      {/* Unread dot — all list_unread results are unread */}
                      <span className="w-2 h-2 rounded-full bg-brand-amber flex-shrink-0" />
                      <span className="text-sm font-semibold text-brand-navy truncate">
                        {msg.from.name || msg.from.email}
                      </span>
                      <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
                        {formatRelativeDate(msg.date, mounted)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 truncate mt-0.5 pl-4">
                      {msg.from.email}
                    </div>
                    <div className="text-sm text-gray-700 truncate mt-0.5 pl-4">
                      {msg.subject}
                    </div>
                    {triage[msg.message_id] && (
                      <div className="mt-1 pl-4">
                        {triage[msg.message_id].priority === "red" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                            Needs attention
                          </span>
                        ) : triage[msg.message_id].priority === "gold" ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                            High intent
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                            Neutral
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>

      {/* Reading pane */}
      <div className="flex-1 overflow-y-auto p-8">
        {!selectedMessage ? (
          <div className="h-full flex items-center justify-center text-gray-400 text-sm">
            Select a message to read
          </div>
        ) : (
          <article className="max-w-3xl mx-auto bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-brand-navy mb-2">
              {displayMessage?.subject ?? selectedMessage.subject}
            </h2>
            <div className="flex items-baseline gap-2 text-sm text-gray-500 mb-4">
              <span className="font-medium text-gray-700">
                {displayMessage?.from.name ?? selectedMessage.from.name}
              </span>
              <span>&lt;{displayMessage?.from.email ?? selectedMessage.from.email}&gt;</span>
              <span className="ml-auto text-xs">
                {formatRelativeDate(
                  displayMessage?.date ?? selectedMessage.date,
                  mounted,
                )}
              </span>
            </div>
            <hr className="mb-4 border-gray-100" />

            {/* D3: Action button row */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <button
                data-testid="reply-btn"
                type="button"
                disabled={!selectedMessage || actionPending}
                onClick={handleReply}
                className="px-3 py-1.5 text-sm rounded bg-brand-navy text-white font-medium hover:opacity-90 transition disabled:opacity-40"
              >
                Reply
              </button>
              <button
                data-testid="archive-btn"
                type="button"
                disabled={!selectedMessage || actionPending}
                onClick={handleArchive}
                className="px-3 py-1.5 text-sm rounded bg-brand-navy text-white font-medium hover:opacity-90 transition disabled:opacity-40"
              >
                Archive
              </button>
              <button
                data-testid="delete-btn"
                type="button"
                disabled={!selectedMessage || actionPending}
                onClick={() => selectedMessage && setConfirmDeleteId(selectedMessage.message_id)}
                className="px-3 py-1.5 text-sm rounded border border-brand-navy text-brand-navy font-medium hover:bg-brand-navy hover:text-white transition disabled:opacity-40"
              >
                Trash
              </button>
              <button
                data-testid="markread-btn"
                type="button"
                disabled={!selectedMessage || actionPending}
                onClick={handleMarkRead}
                className={[
                  "px-3 py-1.5 text-sm rounded border font-medium transition disabled:opacity-40",
                  selectedMessage && readIds.has(selectedMessage.message_id)
                    ? "border-brand-amber text-brand-amber hover:bg-amber-50"
                    : "border-brand-navy text-brand-navy hover:bg-brand-navy hover:text-white",
                ].join(" ")}
              >
                {selectedMessage && readIds.has(selectedMessage.message_id) ? "Mark unread" : "Mark read"}
              </button>
            </div>

            {isPending && (
              <p className="text-sm text-gray-400 animate-pulse">
                Loading message…
              </p>
            )}

            {bodyError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                Could not load message body: {bodyError}
              </p>
            )}

            {!isPending && !bodyError && displayMessage && (() => {
              const { text, html } = getBodyText(displayMessage.body);
              if (html) {
                return (
                  <div
                    className="prose prose-sm max-w-none text-gray-800"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
                  />
                );
              }
              if (text) {
                return (
                  <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">
                    {text}
                  </pre>
                );
              }
              return (
                <p className="text-sm text-gray-400 italic">
                  (empty message body)
                </p>
              );
            })()}
          </article>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={[
            "fixed bottom-6 left-1/2 -translate-x-1/2 rounded shadow-lg px-4 py-3 text-sm z-50 text-white",
            toast.variant === "error" ? "bg-red-700" : "bg-brand-navy",
          ].join(" ")}
        >
          {toast.text}
        </div>
      )}

      {/* Trash confirm dialog — D3: label says Trash, never permanent delete */}
      {confirmDeleteId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        >
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-brand-navy mb-2">Move to Trash?</h3>
            <p className="text-sm text-gray-600 mb-4">
              This message will be moved to your Trash folder and can be recovered.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-brand-navy"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="px-4 py-2 text-sm rounded bg-brand-navy text-white font-medium hover:opacity-90"
              >
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
