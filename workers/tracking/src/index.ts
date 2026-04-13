/**
 * VoxMail tracking worker.
 *
 * Routes (under tracking.voxtn.com):
 *   GET /pixel/:message_id           → 1x1 transparent GIF + logs "open"
 *   GET /click/:message_id?u=<url>   → 301 redirect + logs "click"
 *
 * Side-effect: fires `POST https://ai.nexamail.voxtn.com/track` with the
 * event payload. Uses `ctx.waitUntil` so the response to the email client
 * is not blocked on the logging call. Auth via TRACKING_WORKER_TOKEN
 * (Cloudflare secret, shared with voxmail-ai).
 */

interface Env {
  VOXMAIL_AI_URL: string;
  TRACKING_WORKER_TOKEN: string;
}

// 1x1 transparent GIF (GIF89a), 43 bytes.
const ONE_BY_ONE_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
  0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00,
  0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
  0x00, 0x02, 0x01, 0x44, 0x00, 0x3b,
]);

type EventType = "open" | "click";

async function logEvent(
  env: Env,
  args: {
    messageId: string;
    eventType: EventType;
    redirectUrl?: string;
    userAgent: string | null;
    ip: string | null;
  },
): Promise<void> {
  try {
    const res = await fetch(`${env.VOXMAIL_AI_URL}/track`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.TRACKING_WORKER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message_id: args.messageId,
        event_type: args.eventType,
        redirect_url: args.redirectUrl,
        user_agent: args.userAgent,
        ip: args.ip,
      }),
    });
    if (!res.ok) {
      console.log(`/track returned ${res.status}: ${await res.text()}`);
    }
  } catch (err) {
    console.log(`/track call threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function gifResponse(): Response {
  return new Response(ONE_BY_ONE_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(ONE_BY_ONE_GIF.byteLength),
      // Cache headers that discourage mail clients from caching the pixel,
      // while still returning 200 so recipients don't trigger broken-image UI.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}

function notFound(body = "not found"): Response {
  return new Response(body, {
    status: 404,
    headers: { "Content-Type": "text/plain" },
  });
}

function badRequest(body: string): Response {
  return new Response(body, {
    status: 400,
    headers: { "Content-Type": "text/plain" },
  });
}

function isSafeRedirect(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // drop empty
    const kind = parts[0];
    const messageId = parts[1];

    const ip =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null;
    const userAgent = request.headers.get("user-agent");

    if (kind === "pixel") {
      if (!messageId) return badRequest("missing message id");
      ctx.waitUntil(
        logEvent(env, {
          messageId,
          eventType: "open",
          userAgent,
          ip,
        }),
      );
      return gifResponse();
    }

    if (kind === "click") {
      if (!messageId) return badRequest("missing message id");
      const target = url.searchParams.get("u");
      if (!target) return badRequest("missing ?u=<url>");
      const decoded = decodeURIComponent(target);
      if (!isSafeRedirect(decoded)) {
        return badRequest("unsafe redirect target");
      }
      ctx.waitUntil(
        logEvent(env, {
          messageId,
          eventType: "click",
          redirectUrl: decoded,
          userAgent,
          ip,
        }),
      );
      return Response.redirect(decoded, 301);
    }

    if (kind === "health") {
      return new Response("ok", { status: 200 });
    }

    return notFound("voxmail-tracking: unknown route");
  },
};
