"use client";

import { useKeyboardShortcuts } from "@/lib/hooks/useKeyboardShortcuts";

/**
 * Thin client component that activates keyboard shortcuts in the shell layout.
 * Renders nothing — purely a hook mount point.
 */
export function ShellKeyboardShortcuts() {
  useKeyboardShortcuts();
  return null;
}
