// Shared email-HTML sanitizer for all `dangerouslySetInnerHTML` sinks.
// Replaces the previous regex sanitizer (which missed javascript:/data: URIs,
// <style>, malformed tags). DOMPurify is a vetted allowlist sanitizer that runs
// on both the server (jsdom) and the client via isomorphic-dompurify.
import DOMPurify from "isomorphic-dompurify";

// Only safe link/resource schemes; blocks javascript: and data: entirely.
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|cid:|tel:)/i;

let hookInstalled = false;
function installHook(): void {
  if (hookInstalled) return;
  // Force external links to open safely and not leak the opener.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
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
    // on* handlers are stripped by default; also block data-* and inline CSS @import via scheme allowlist.
    ALLOWED_URI_REGEXP,
    ALLOW_DATA_ATTR: false,
  });
}
