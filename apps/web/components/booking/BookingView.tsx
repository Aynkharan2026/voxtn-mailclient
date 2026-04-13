"use client";

import { useEffect, useState } from "react";

/**
 * Cal.com inline embed for a self-hosted instance.
 *
 * Loads `<calOrigin>/embed/embed.js` once, then calls `window.Cal("inline")`
 * to mount the widget into #voxmail-cal-embed. Brand colour is set via
 * `Cal("ui")` so the embed matches VoxMail amber/navy.
 *
 * No npm dependency on @calcom/embed-react (avoids React 19 peer-dep churn).
 */

declare global {
  interface Window {
    Cal?: ((...args: unknown[]) => void) & {
      loaded?: boolean;
      ns?: Record<string, unknown>;
      q?: unknown[];
    };
  }
}

type Props = { slug: string; calOrigin: string };

export function BookingView({ slug, calOrigin }: Props) {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const origin = calOrigin.replace(/\/$/, "");
    const embedSrc = `${origin}/embed/embed.js`;
    const scriptSelector = `script[data-voxmail-cal-embed]`;

    const init = () => {
      const Cal = window.Cal;
      if (!Cal) {
        setError("Cal.com embed script loaded but window.Cal is missing");
        return;
      }
      try {
        Cal("init", { origin });
        Cal("inline", {
          elementOrSelector: "#voxmail-cal-embed",
          calLink: slug,
          layout: "month_view",
        });
        Cal("ui", {
          styles: { branding: { brandColor: "#f59e0b" } },
          hideEventTypeDetails: false,
          theme: "light",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    const existing = document.querySelector<HTMLScriptElement>(scriptSelector);
    if (existing) {
      if (window.Cal) {
        init();
      } else {
        existing.addEventListener("load", init, { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = embedSrc;
    script.async = true;
    script.dataset.voxmailCalEmbed = "true";
    script.addEventListener("load", init, { once: true });
    script.addEventListener("error", () =>
      setError(`Failed to load Cal.com embed script from ${embedSrc}`),
    );
    document.head.appendChild(script);
  }, [slug, calOrigin]);

  if (error) {
    return (
      <div className="p-6 text-sm text-red-700 bg-red-50">
        Booking widget unavailable: {error}
      </div>
    );
  }

  return (
    <div
      id="voxmail-cal-embed"
      style={{ width: "100%", minHeight: "720px", overflow: "auto" }}
    />
  );
}
