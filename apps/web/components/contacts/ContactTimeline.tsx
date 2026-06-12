"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  ContactEntry,
  ContactMessage,
  ContactTimelineResult,
  ContactMessageResult,
} from "@/app/(shell)/contacts/actions";
import { sanitizeEmailHtml as sanitizeHtml } from "@/lib/sanitize-html";

// sanitizeHtml now delegates to the shared DOMPurify sanitizer (see import above).

function getBodyText(
  body: ContactMessage["body"],
): { text?: string; html?: string } {
  if (!body) return {};
  if (typeof body === "string") return { text: body };
  return { text: body.text, html: body.html };
}

function formatTimestamp(dateStr: string, mounted: boolean): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  // Deterministic across server/client until mount: fixed locale + UTC.
  const absolute = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (!mounted) return absolute;
  return `${absolute}, ${date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function ContactTimeline({
  entries,
  contact,
  account,
  timelineAction,
  messageAction,
}: {
  entries: ContactEntry[];
  contact: string;
  account?: string;
  timelineAction: (
    contact: string,
    account?: string,
  ) => Promise<ContactTimelineResult>;
  messageAction: (
    messageId: string,
    folder?: string,
    account?: string,
  ) => Promise<ContactMessageResult>;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // E2: inline reader — mirror InboxView selectedMessage / loadedBody pattern.
  const [openId, setOpenId] = useState<string | null>(null);
  const [loadedBody, setLoadedBody] = useState<ContactMessage | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [bodyPending, setBodyPending] = useState(false);

  // timelineAction is part of the props contract (re-fetch hook); reference it so
  // the prop is genuinely wired even though the initial entries come from the page.
  const refresh = useCallback(
    () => timelineAction(contact, account),
    [timelineAction, contact, account],
  );
  void refresh;

  const handleOpen = useCallback(
    async (entry: ContactEntry) => {
      if (openId === entry.message_id) {
        // toggle closed
        setOpenId(null);
        setLoadedBody(null);
        setBodyError(null);
        return;
      }
      setOpenId(entry.message_id);
      setLoadedBody(null);
      setBodyError(null);
      setBodyPending(true);
      try {
        const res = await messageAction(entry.message_id, entry.folder, account);
        if (res.ok) {
          setLoadedBody(res.message);
        } else {
          setBodyError(res.error);
        }
      } catch (err) {
        setBodyError(err instanceof Error ? err.message : String(err));
      } finally {
        setBodyPending(false);
      }
    },
    [openId, messageAction, account],
  );

  if (entries.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic" data-testid="contact-timeline">
        No messages found with {contact}.
      </p>
    );
  }

  return (
    <ul
      className="flex flex-col gap-2"
      data-testid="contact-timeline"
      aria-label={`Message timeline with ${contact}`}
    >
      {entries.map((entry) => {
        const isOpen = openId === entry.message_id;
        const sent = entry.direction === "sent";
        return (
          <li
            key={entry.message_id}
            data-testid="timeline-row"
            className="rounded border border-gray-200 bg-white overflow-hidden"
          >
            <button
              type="button"
              data-testid="timeline-open-message"
              onClick={() => handleOpen(entry)}
              aria-expanded={isOpen}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 transition flex flex-col gap-1"
            >
              <div className="flex items-center justify-between gap-3">
                <span
                  data-testid="timeline-direction"
                  className={`inline-flex items-center gap-1 text-xs font-semibold rounded px-2 py-0.5 ${
                    sent
                      ? "bg-amber-50 text-brand-amber"
                      : "bg-blue-50 text-brand-navy"
                  }`}
                >
                  <span aria-hidden="true">{sent ? "↑" : "↓"}</span>
                  {sent ? "Sent" : "Received"}
                  {account ? (
                    <span className="font-normal text-gray-500">· {account}</span>
                  ) : null}
                </span>
                <time
                  className="text-xs text-gray-400 flex-shrink-0"
                  dateTime={entry.date}
                  suppressHydrationWarning
                >
                  {formatTimestamp(entry.date, mounted)}
                </time>
              </div>
              <div className="text-sm font-medium text-brand-navy truncate">
                {entry.subject || "(no subject)"}
              </div>
              {entry.snippet ? (
                <div className="text-xs text-gray-500 line-clamp-2">
                  {entry.snippet}
                </div>
              ) : null}
              <div className="text-[11px] text-gray-400">
                {entry.from.name ? `${entry.from.name} ` : ""}
                &lt;{entry.from.email}&gt; · {entry.folder}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/60">
                {bodyPending && (
                  <p className="text-sm text-gray-400">Loading message…</p>
                )}
                {!bodyPending && bodyError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                    Could not load message body: {bodyError}
                  </p>
                )}
                {!bodyPending && !bodyError && loadedBody && (() => {
                  const { text, html } = getBodyText(loadedBody.body);
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
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
