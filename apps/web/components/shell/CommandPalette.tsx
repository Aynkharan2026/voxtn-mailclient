"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { Account } from "@/app/shell/actions";

type PaletteAction = {
  id: string;
  label: string;
  description?: string;
  run: () => void;
};

export function CommandPalette({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Build actions list
  const buildActions = useCallback((): PaletteAction[] => {
    const base: PaletteAction[] = [
      {
        id: "goto-inbox",
        label: "Go to Inbox",
        description: "Open your inbox",
        run: () => { router.push("/inbox"); setOpen(false); },
      },
      {
        id: "goto-compose",
        label: "Compose",
        description: "Open compose window",
        run: () => { router.push("/compose"); setOpen(false); },
      },
      {
        id: "goto-briefing",
        label: "Go to Briefing",
        description: "Open daily briefing",
        run: () => { router.push("/briefing"); setOpen(false); },
      },
      {
        id: "goto-settings",
        label: "Go to Settings",
        description: "Open settings",
        run: () => { router.push("/settings/signatures"); setOpen(false); },
      },
      {
        id: "focus-search",
        label: "Search",
        description: "Focus the inbox search box",
        run: () => {
          setOpen(false);
          setTimeout(() => {
            const el = document.querySelector<HTMLInputElement>("[data-testid='nl-search']");
            el?.focus();
          }, 50);
        },
      },
    ];

    // Switch account actions
    const accountActions: PaletteAction[] = accounts.map((acct) => ({
      id: `switch-${acct.email_address}`,
      label: `Switch to ${acct.display_name !== acct.email_address ? acct.display_name : acct.email_address}`,
      description: acct.email_address,
      run: () => {
        const params = new URLSearchParams(window.location.search);
        params.set("account", acct.email_address);
        router.push(`${window.location.pathname}?${params.toString()}`);
        setOpen(false);
      },
    }));

    return [...base, ...accountActions];
  }, [router, accounts]);

  const allActions = buildActions();

  const filtered = query.trim()
    ? allActions.filter(
        (a) =>
          a.label.toLowerCase().includes(query.toLowerCase()) ||
          (a.description ?? "").toLowerCase().includes(query.toLowerCase()),
      )
    : allActions;

  // Clamp cursor when filtered list changes
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Cmd/Ctrl+K to open
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setCursor(0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // Keyboard nav inside palette
  function onPaletteKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[cursor]?.run();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40"
      onClick={() => setOpen(false)}
    >
      <div
        data-testid="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onPaletteKeyDown}
      >
        <div className="border-b border-gray-100 px-4 py-3">
          <input
            ref={inputRef}
            data-testid="command-palette-input"
            type="text"
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            className="w-full text-sm outline-none bg-transparent placeholder-gray-400"
          />
        </div>

        <ul role="listbox" className="max-h-72 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-gray-400">No results</li>
          ) : (
            filtered.map((action, idx) => (
              <li
                key={action.id}
                role="option"
                aria-selected={idx === cursor}
                onClick={() => action.run()}
                className={[
                  "flex items-center gap-3 px-4 py-2.5 cursor-pointer text-sm transition",
                  idx === cursor
                    ? "bg-amber-50 text-brand-navy"
                    : "text-gray-700 hover:bg-gray-50",
                ].join(" ")}
              >
                <span className="font-medium">{action.label}</span>
                {action.description && (
                  <span className="ml-auto text-xs text-gray-400 truncate max-w-[200px]">
                    {action.description}
                  </span>
                )}
              </li>
            ))
          )}
        </ul>

        <div className="border-t border-gray-100 px-4 py-2 flex items-center gap-3 text-xs text-gray-400">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
