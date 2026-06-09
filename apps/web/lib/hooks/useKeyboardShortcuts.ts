"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * useKeyboardShortcuts — single-key shortcuts when NOT focused in a text input.
 *
 * Shortcuts:
 *   c         → navigate to /compose
 *   /         → focus [data-testid="nl-search"]
 *   g i       → navigate to /inbox   (sequence: press g then i within 800ms)
 *   g b       → navigate to /briefing
 *
 * Keys are ignored when the focus target is an input, textarea, select, or
 * a contentEditable element. This prevents hijacking while the user is typing.
 */
export function useKeyboardShortcuts() {
  const router = useRouter();
  // Track pending "g" key for sequence shortcuts
  const pendingGRef = useRef(false);
  const pendingGTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function isTypingContext(target: EventTarget | null): boolean {
      if (!target || !(target instanceof HTMLElement)) return false;
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (target.isContentEditable) return true;
      return false;
    }

    function clearPendingG() {
      pendingGRef.current = false;
      if (pendingGTimerRef.current) {
        clearTimeout(pendingGTimerRef.current);
        pendingGTimerRef.current = null;
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      // Ignore modifier combos (Cmd/Ctrl/Alt shortcuts — handled by CommandPalette etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingContext(e.target)) return;

      // Handle second key of "g" sequence
      if (pendingGRef.current) {
        clearPendingG();
        if (e.key === "i") {
          e.preventDefault();
          router.push("/inbox");
        } else if (e.key === "b") {
          e.preventDefault();
          router.push("/briefing");
        }
        return;
      }

      if (e.key === "c") {
        e.preventDefault();
        router.push("/compose");
      } else if (e.key === "/") {
        e.preventDefault();
        const el = document.querySelector<HTMLInputElement>("[data-testid='nl-search']");
        el?.focus();
      } else if (e.key === "g") {
        e.preventDefault();
        pendingGRef.current = true;
        // Clear pending state after 800ms if no second key arrives
        pendingGTimerRef.current = setTimeout(clearPendingG, 800);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearPendingG();
    };
  }, [router]);
}
