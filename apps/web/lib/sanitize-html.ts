// Shared email-HTML sanitizer for all `dangerouslySetInnerHTML` sinks.
// Replaces the previous regex sanitizer (which missed javascript:/data: URIs,
// <style>, malformed tags). Uses DOMPurify — a vetted allowlist sanitizer.
//
// NOTE: this only ever runs in the browser. Email bodies are fetched on user
// selection (client-side) and rendered inside "use client" components, so we use
// the browser build of dompurify and short-circuit during SSR (where no body is
// rendered). This avoids bundling jsdom into the serverless runtime — which was
// breaking the inbox SSR with isomorphic-dompurify.
import DOMPurify from "dompurify";

// Only safe link/resource schemes; blocks javascript: and data: entirely.
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|cid:|tel:)/i;

let hookInstalled = false;
function installHook(): void {
  if (hookInstalled) return;
  // Force external links to open safely and not leak the opener.
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (node.tagName === "A" && node.getAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  hookInstalled = true;
}

/** Sanitize untrusted email HTML before rendering via dangerouslySetInnerHTML. */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return "";
  // SSR: message bodies are only loaded + rendered client-side; nothing to do.
  if (typeof window === "undefined") return "";
  installHook();
  return DOMPurify.sanitize(html, {
    // Drop active-content and CSS-injection vectors entirely.
    FORBID_TAGS: [
      "script",
      "style",
      "iframe",
      "object",
      "embed",
      "form",
      "base",
      "link",
      "meta",
      "svg",
    ],
    // on* handlers are stripped by default; scheme-allowlist blocks javascript: + data:.
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
  });
}
