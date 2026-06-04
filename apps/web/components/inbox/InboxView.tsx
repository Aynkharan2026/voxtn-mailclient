"use client";

import { useState, useTransition, useMemo } from "react";
import type { InboxMessage, GetMessageResult } from "@/app/inbox/actions";

type Folder = "inbox" | "sent" | "drafts" | "spam" | "trash" | "archive";

const FOLDERS: { key: Folder; label: string }[] = [
  { key: "inbox", label: "Inbox" },
  { key: "sent", label: "Sent" },
  { key: "drafts", label: "Drafts" },
  { key: "spam", label: "Spam" },
  { key: "trash", label: "Trash" },
  { key: "archive", label: "Archive" },
];

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

export function InboxView({
  initialMessages,
  getMessageAction,
}: {
  initialMessages: InboxMessage[];
  getMessageAction: (id: string) => Promise<GetMessageResult>;
}) {
  const [activeFolder, setActiveFolder] = useState<Folder>("inbox");
  const [search, setSearch] = useState("");
  const [selectedMessage, setSelectedMessage] = useState<InboxMessage | null>(
    null,
  );
  const [loadedBody, setLoadedBody] = useState<InboxMessage | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredMessages = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return initialMessages;
    return initialMessages.filter(
      (m) =>
        m.from.name.toLowerCase().includes(q) ||
        m.from.email.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q),
    );
  }, [initialMessages, search]);

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
                        {formatRelativeDate(msg.date)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 truncate mt-0.5 pl-4">
                      {msg.from.email}
                    </div>
                    <div className="text-sm text-gray-700 truncate mt-0.5 pl-4">
                      {msg.subject}
                    </div>
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
                )}
              </span>
            </div>
            <hr className="mb-4 border-gray-100" />

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
    </div>
  );
}
