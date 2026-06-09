"use client";

import { useState, useEffect, useTransition, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  InboxMessage,
  GetMessageResult,
  ReplyDraftResult,
  ReplyAllDraftResult,
  ForwardDraftResult,
  FlagResult,
  LabelResult,
  GetThreadResult,
  ThreadMessage,
  ArchiveResult,
  DeleteResult,
  MarkReadResult,
} from "@/app/(shell)/inbox/actions";
import type { SummarizeResult, SemanticSearchResult } from "@/lib/actions/ai-intel";

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
  replyAllAction,
  forwardAction,
  flagAction,
  labelAction,
  getThreadAction,
  archiveAction,
  deleteAction,
  markReadAction,
  summarizeThreadAction,
  semanticSearchAction,
  triage = {},
  activeAccount,
  readOnly = false,
}: {
  initialMessages: InboxMessage[];
  getMessageAction: (id: string, account?: string) => Promise<GetMessageResult>;
  replyDraftAction: (id: string, account?: string) => Promise<ReplyDraftResult>;
  replyAllAction: (id: string, account?: string) => Promise<ReplyAllDraftResult>;
  forwardAction: (id: string, account?: string) => Promise<ForwardDraftResult>;
  flagAction: (id: string, account?: string, flagged?: boolean) => Promise<FlagResult>;
  labelAction: (id: string, account?: string, add?: string, remove?: string) => Promise<LabelResult>;
  getThreadAction: (id: string, account?: string) => Promise<GetThreadResult>;
  archiveAction: (id: string, account?: string) => Promise<ArchiveResult>;
  deleteAction: (id: string, account?: string) => Promise<DeleteResult>;
  markReadAction: (id: string, account?: string) => Promise<MarkReadResult>;
  summarizeThreadAction?: (messages: ThreadMessage[]) => Promise<SummarizeResult>;
  semanticSearchAction?: (query: string, candidates: { id: string; subject: string; snippet?: string }[]) => Promise<SemanticSearchResult>;
  triage?: Record<string, TriageState>;
  activeAccount?: string;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

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
  // W2: Star/flag state (per message)
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  // W2: Labels state (per message)
  const [messageLabels, setMessageLabels] = useState<Record<string, string[]>>({});
  // W2: Label input visibility
  const [showLabelInput, setShowLabelInput] = useState(false);
  const [labelInput, setLabelInput] = useState("");
  // W2: Thread view
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[] | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [threadPending, setThreadPending] = useState(false);

  // W2-intel: Thread summary
  const [summary, setSummary] = useState<{ headline: string; bullets: string[] } | null>(null);
  const [summaryPending, setSummaryPending] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  // W2-intel: NL semantic search
  const [nlQuery, setNlQuery] = useState("");
  const [nlRanked, setNlRanked] = useState<string[] | null>(null); // null = no search active
  const [nlPending, setNlPending] = useState(false);

  const showToast = useCallback((text: string, variant: "success" | "error") => {
    setToast({ text, variant });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // W2-intel: NL semantic search handler
  const handleNlSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setNlRanked(null);
      return;
    }
    if (!semanticSearchAction) return;
    setNlPending(true);
    try {
      const candidates = initialMessages
        .filter((m) => !removedIds.has(m.message_id))
        .map((m) => ({
          id: m.message_id,
          subject: m.subject,
          snippet:
            typeof m.body === "string"
              ? m.body.slice(0, 150)
              : m.body?.text?.slice(0, 150),
        }));
      const res = await semanticSearchAction(q, candidates);
      if (res.ok) {
        setNlRanked(res.ranked);
      }
    } finally {
      setNlPending(false);
    }
  }, [semanticSearchAction, initialMessages, removedIds]);

  const filteredMessages = useMemo(() => {
    const q = search.toLowerCase().trim();
    // Base filter (remove archived/deleted + local text search)
    const base = initialMessages.filter((m) => {
      if (removedIds.has(m.message_id)) return false;
      if (!q) return true;
      return (
        m.from.name.toLowerCase().includes(q) ||
        m.from.email.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q)
      );
    });
    // If NL semantic search has results, reorder + filter by ranked ids
    if (nlRanked !== null && nlRanked.length > 0) {
      const rankIndex = new Map(nlRanked.map((id, i) => [id, i]));
      return base
        .filter((m) => rankIndex.has(m.message_id))
        .sort((a, b) => (rankIndex.get(a.message_id) ?? 9999) - (rankIndex.get(b.message_id) ?? 9999));
    }
    return base;
  }, [initialMessages, search, removedIds, nlRanked]);

  function handleSelectMessage(msg: InboxMessage) {
    setSelectedMessage(msg);
    setLoadedBody(null);
    setBodyError(null);
    setThreadMessages(null);
    setThreadError(null);
    setSummary(null);
    setSummaryExpanded(false);
    setShowLabelInput(false);
    setLabelInput("");
    startTransition(async () => {
      const result = await getMessageAction(msg.message_id, activeAccount);
      if (result.ok) {
        setLoadedBody(result.message);
      } else {
        setBodyError(result.error);
      }
    });
    // Fetch thread in background, then summarize
    setThreadPending(true);
    getThreadAction(msg.message_id, activeAccount).then((res) => {
      setThreadPending(false);
      if (res.ok) {
        setThreadMessages(res.messages);
        // Fetch thread summary if action is available and thread has messages
        if (summarizeThreadAction && res.messages.length > 0) {
          setSummaryPending(true);
          summarizeThreadAction(res.messages).then((sumRes) => {
            setSummaryPending(false);
            if (sumRes.ok) {
              setSummary({ headline: sumRes.headline, bullets: sumRes.bullets });
            }
            // Silently ignore summary failure
          }).catch(() => { setSummaryPending(false); });
        }
      } else {
        setThreadError(res.error);
      }
    }).catch(() => {
      setThreadPending(false);
    });
  }

  const displayMessage = loadedBody ?? selectedMessage;

  // D3 action handlers
  const handleReply = useCallback(async () => {
    if (!selectedMessage) return;
    setActionPending(true);
    try {
      const draft = await replyDraftAction(selectedMessage.message_id, activeAccount);
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
  }, [selectedMessage, displayMessage, replyDraftAction, router, activeAccount]);

  const handleArchive = useCallback(async () => {
    if (!selectedMessage) return;
    setActionPending(true);
    const id = selectedMessage.message_id;
    try {
      const res = await archiveAction(id, activeAccount);
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
  }, [selectedMessage, archiveAction, showToast, activeAccount]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!confirmDeleteId) return;
    setConfirmDeleteId(null);
    setActionPending(true);
    const id = confirmDeleteId;
    try {
      const res = await deleteAction(id, activeAccount);
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
  }, [confirmDeleteId, deleteAction, showToast, activeAccount]);

  const handleMarkRead = useCallback(async () => {
    if (!selectedMessage) return;
    setActionPending(true);
    const id = selectedMessage.message_id;
    try {
      const res = await markReadAction(id, activeAccount);
      if (res.ok) {
        setReadIds((prev) => new Set(prev).add(id));
        showToast("Marked as read", "success");
      } else {
        showToast(`Mark read failed: ${res.error}`, "error");
      }
    } finally {
      setActionPending(false);
    }
  }, [selectedMessage, markReadAction, showToast, activeAccount]);

  // W2: Reply-all handler
  const handleReplyAll = useCallback(async () => {
    if (!selectedMessage) return;
    setActionPending(true);
    try {
      const draft = await replyAllAction(selectedMessage.message_id, activeAccount);
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
        // Graceful fallback
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
  }, [selectedMessage, displayMessage, replyAllAction, router, activeAccount]);

  // W2: Forward handler
  const handleForward = useCallback(async () => {
    if (!selectedMessage) return;
    setActionPending(true);
    try {
      const draft = await forwardAction(selectedMessage.message_id, activeAccount);
      let params: Record<string, string>;
      if (draft.ok) {
        let body = draft.forwarded_body;
        if (draft.attachment_note) {
          body = `${body}\n\n[Attachments: ${draft.attachment_note}]`;
        }
        params = {
          subject: draft.subject,
          body,
          to: "",
        };
      } else {
        // Graceful fallback
        const subject = displayMessage?.subject ?? selectedMessage.subject;
        const fallbackSubject = subject.startsWith("Fwd:") ? subject : `Fwd: ${subject}`;
        params = { subject: fallbackSubject, body: "", to: "" };
      }
      const qs = new URLSearchParams(params).toString();
      router.push(`/compose?${qs}`);
    } finally {
      setActionPending(false);
    }
  }, [selectedMessage, displayMessage, forwardAction, router, activeAccount]);

  // W2: Star/flag toggle handler
  const handleStar = useCallback(async () => {
    if (!selectedMessage) return;
    const id = selectedMessage.message_id;
    const currentlyStarred = starredIds.has(id);
    setActionPending(true);
    try {
      const res = await flagAction(id, activeAccount, !currentlyStarred);
      if (res.ok) {
        setStarredIds((prev) => {
          const next = new Set(prev);
          if (res.flagged) {
            next.add(id);
          } else {
            next.delete(id);
          }
          return next;
        });
        showToast(res.flagged ? "Starred" : "Unstarred", "success");
      } else {
        showToast(`Star failed: ${res.error}`, "error");
      }
    } finally {
      setActionPending(false);
    }
  }, [selectedMessage, flagAction, starredIds, showToast, activeAccount]);

  // W2: Add label handler
  const handleAddLabel = useCallback(async () => {
    if (!selectedMessage || !labelInput.trim()) return;
    const id = selectedMessage.message_id;
    const label = labelInput.trim();
    setActionPending(true);
    try {
      const res = await labelAction(id, activeAccount, label, undefined);
      if (res.ok) {
        setMessageLabels((prev) => ({ ...prev, [id]: res.labels }));
        setLabelInput("");
        setShowLabelInput(false);
        showToast(`Label "${label}" added`, "success");
      } else {
        showToast(`Label failed: ${res.error}`, "error");
      }
    } finally {
      setActionPending(false);
    }
  }, [selectedMessage, labelAction, labelInput, showToast, activeAccount]);

  // W2: Remove label handler
  const handleRemoveLabel = useCallback(async (label: string) => {
    if (!selectedMessage) return;
    const id = selectedMessage.message_id;
    setActionPending(true);
    try {
      const res = await labelAction(id, activeAccount, undefined, label);
      if (res.ok) {
        setMessageLabels((prev) => ({ ...prev, [id]: res.labels }));
        showToast(`Label "${label}" removed`, "success");
      } else {
        showToast(`Remove label failed: ${res.error}`, "error");
      }
    } finally {
      setActionPending(false);
    }
  }, [selectedMessage, labelAction, showToast, activeAccount]);

  return (
    <div className="flex h-full overflow-hidden bg-gray-50 min-w-0">
      {/* Message list */}
      <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
        {/* Account label */}
        {activeAccount && (
          <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-xs text-gray-400 truncate">
            {activeAccount}
          </div>
        )}
        <div className="p-3 border-b border-gray-100 space-y-2">
          {/* Local text search */}
          <input
            type="search"
            placeholder="Search inbox…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-amber"
          />
          {/* NL semantic search */}
          <div className="relative">
            <input
              data-testid="nl-search"
              type="search"
              placeholder="AI search (describe what you're looking for)…"
              value={nlQuery}
              onChange={(e) => setNlQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void handleNlSearch(nlQuery);
                } else if (e.key === "Escape") {
                  setNlQuery("");
                  setNlRanked(null);
                }
              }}
              className="w-full px-3 py-1.5 text-sm border border-blue-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-300 pr-16"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {nlPending && (
                <span className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
              )}
              {nlRanked !== null && (
                <button
                  type="button"
                  onClick={() => { setNlQuery(""); setNlRanked(null); }}
                  className="text-xs text-gray-400 hover:text-brand-navy"
                  aria-label="Clear AI search"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          {nlRanked !== null && (
            <p className="text-xs text-blue-500">
              Showing {filteredMessages.length} AI-matched result{filteredMessages.length !== 1 ? "s" : ""}
            </p>
          )}
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
            {/* D3: show active account in reading-pane header */}
            {activeAccount && (
              <div className="text-xs text-gray-400 mb-3">
                Account: <span className="font-medium">{activeAccount}</span>
              </div>
            )}
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

            {/* W2-intel: Thread summary */}
            {(summaryPending || summary) && (
              <div data-testid="thread-summary" className="mb-4 border border-blue-100 rounded-lg bg-blue-50/60 overflow-hidden">
                {summaryPending ? (
                  <div className="px-4 py-3 text-xs text-blue-400 animate-pulse">Summarizing thread…</div>
                ) : summary ? (
                  <details
                    open={summaryExpanded}
                    onToggle={(e) => setSummaryExpanded((e.target as HTMLDetailsElement).open)}
                  >
                    <summary className="px-4 py-2.5 text-sm font-medium text-blue-700 cursor-pointer select-none hover:bg-blue-50 list-none flex items-center gap-2">
                      <span className="text-blue-400">◆</span>
                      <span className="flex-1 truncate">{summary.headline}</span>
                      <span className="text-xs text-blue-400 flex-shrink-0">
                        {summaryExpanded ? "▲" : "▼"}
                      </span>
                    </summary>
                    {summaryExpanded && summary.bullets.length > 0 && (
                      <ul className="px-5 pb-3 pt-1 space-y-1">
                        {summary.bullets.map((b, i) => (
                          <li key={i} className="text-xs text-blue-700 flex items-start gap-1.5">
                            <span className="text-blue-300 flex-shrink-0 mt-0.5">•</span>
                            {b}
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                ) : null}
              </div>
            )}

            {/* Read-only banner */}
            {readOnly && (
              <div className="mb-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-700 font-medium">
                Read-only mode — mutations are disabled
              </div>
            )}

            {/* D3 + W2: Action button row */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <button
                data-testid="reply-btn"
                type="button"
                disabled={!selectedMessage || actionPending || readOnly}
                onClick={handleReply}
                className="px-3 py-1.5 text-sm rounded bg-brand-navy text-white font-medium hover:opacity-90 transition disabled:opacity-40"
              >
                Reply
              </button>
              <button
                data-testid="replyall-btn"
                type="button"
                disabled={!selectedMessage || actionPending || readOnly}
                onClick={handleReplyAll}
                className="px-3 py-1.5 text-sm rounded bg-brand-navy text-white font-medium hover:opacity-90 transition disabled:opacity-40"
              >
                Reply All
              </button>
              <button
                data-testid="forward-btn"
                type="button"
                disabled={!selectedMessage || actionPending || readOnly}
                onClick={handleForward}
                className="px-3 py-1.5 text-sm rounded bg-brand-navy text-white font-medium hover:opacity-90 transition disabled:opacity-40"
              >
                Forward
              </button>
              <button
                data-testid="star-btn"
                type="button"
                disabled={!selectedMessage || actionPending || readOnly}
                onClick={handleStar}
                aria-label={selectedMessage && starredIds.has(selectedMessage.message_id) ? "Unstar" : "Star"}
                className={[
                  "px-3 py-1.5 text-sm rounded border font-medium transition disabled:opacity-40",
                  selectedMessage && starredIds.has(selectedMessage.message_id)
                    ? "border-brand-amber bg-amber-50 text-brand-amber"
                    : "border-gray-300 text-gray-500 hover:border-brand-amber hover:text-brand-amber",
                ].join(" ")}
              >
                {selectedMessage && starredIds.has(selectedMessage.message_id) ? "★" : "☆"}
              </button>
              <button
                data-testid="label-btn"
                type="button"
                disabled={!selectedMessage || actionPending || readOnly}
                onClick={() => setShowLabelInput((v) => !v)}
                className="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 font-medium hover:border-brand-navy hover:text-brand-navy transition disabled:opacity-40"
              >
                Label
              </button>
              <button
                data-testid="archive-btn"
                type="button"
                disabled={!selectedMessage || actionPending || readOnly}
                onClick={handleArchive}
                className="px-3 py-1.5 text-sm rounded bg-brand-navy text-white font-medium hover:opacity-90 transition disabled:opacity-40"
              >
                Archive
              </button>
              <button
                data-testid="delete-btn"
                type="button"
                disabled={!selectedMessage || actionPending || readOnly}
                onClick={() => selectedMessage && setConfirmDeleteId(selectedMessage.message_id)}
                className="px-3 py-1.5 text-sm rounded border border-brand-navy text-brand-navy font-medium hover:bg-brand-navy hover:text-white transition disabled:opacity-40"
              >
                Trash
              </button>
              <button
                data-testid="markread-btn"
                type="button"
                disabled={!selectedMessage || actionPending || readOnly}
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

            {/* W2: Label input */}
            {showLabelInput && selectedMessage && (
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddLabel(); }}
                  placeholder="Add label…"
                  className="px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-amber"
                />
                <button
                  type="button"
                  onClick={handleAddLabel}
                  disabled={!labelInput.trim() || actionPending}
                  className="px-2 py-1 text-sm rounded bg-brand-navy text-white font-medium hover:opacity-90 disabled:opacity-40"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => { setShowLabelInput(false); setLabelInput(""); }}
                  className="px-2 py-1 text-sm text-gray-500 hover:text-brand-navy"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* W2: Label chips */}
            {selectedMessage && messageLabels[selectedMessage.message_id] && messageLabels[selectedMessage.message_id].length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {messageLabels[selectedMessage.message_id].map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700"
                  >
                    {label}
                    <button
                      type="button"
                      onClick={() => handleRemoveLabel(label)}
                      aria-label={`Remove label ${label}`}
                      className="ml-0.5 hover:text-blue-900"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

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

            {/* W2: Thread view */}
            <div data-testid="thread-view" className="mt-6">
              {threadPending && (
                <p className="text-xs text-gray-400 animate-pulse">Loading thread…</p>
              )}
              {threadError && (
                <p className="text-xs text-red-500">Thread unavailable: {threadError}</p>
              )}
              {!threadPending && !threadError && threadMessages && threadMessages.length > 1 && (
                <details open className="border border-gray-100 rounded">
                  <summary className="px-3 py-2 text-xs font-medium text-gray-500 cursor-pointer hover:bg-gray-50 select-none">
                    Thread ({threadMessages.length} messages)
                  </summary>
                  <ol className="divide-y divide-gray-100">
                    {[...threadMessages]
                      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                      .map((tm) => (
                        <li key={tm.message_id} className="px-3 py-2">
                          <div className="flex items-center gap-2 text-xs text-gray-600">
                            <span className="font-medium truncate max-w-[140px]">
                              {tm.from.name || tm.from.email}
                            </span>
                            <span className="ml-auto text-gray-400 flex-shrink-0">
                              {formatRelativeDate(tm.date, mounted)}
                            </span>
                          </div>
                          {tm.subject && (
                            <div className="text-xs text-gray-700 truncate mt-0.5">{tm.subject}</div>
                          )}
                          {tm.snippet && (
                            <div className="text-xs text-gray-400 truncate mt-0.5">{tm.snippet}</div>
                          )}
                        </li>
                      ))}
                  </ol>
                </details>
              )}
            </div>
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
