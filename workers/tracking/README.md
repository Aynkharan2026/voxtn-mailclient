# voxmail-tracking (Cloudflare Worker)

Open-pixel + click-redirect tracking for VoxMail outbound email. Deployed to `tracking.voxtn.com`.

## Routes

| Path                              | Response                                                | Event logged         |
|-----------------------------------|---------------------------------------------------------|----------------------|
| `GET /pixel/:message_id`          | 200 with 1×1 transparent GIF (`image/gif`, no-cache)    | `open`               |
| `GET /click/:message_id?u=<url>`  | 301 redirect to `<url>` (http/https only)               | `click` + `redirect_url` |
| `GET /health`                     | 200 `ok`                                                | —                    |

For each hit, the worker fires an async (non-blocking) `POST` to `https://ai.nexamail.voxtn.com/track` with `{ message_id, event_type, redirect_url?, user_agent, ip }` authenticated by `Authorization: Bearer $TRACKING_WORKER_TOKEN`.

## One-time setup

```bash
# 1. install deps
cd workers/tracking
npm install

# 2. log in
npx wrangler login

# 3. set the shared secret (must match TRACKING_WORKER_TOKEN on voxmail-ai)
npx wrangler secret put TRACKING_WORKER_TOKEN

# 4. DNS: add a proxied (orange-cloud) record for tracking.voxtn.com in Cloudflare
#    The value doesn't matter (Workers Routes override) — an AAAA to 100:: works.
#    Or use the Workers dashboard "Custom Domains" UI which sets DNS for you.

# 5. deploy
npm run deploy
```

## Verify

```bash
curl -i "https://tracking.voxtn.com/health"
# → 200 ok

curl -i "https://tracking.voxtn.com/pixel/test-message-1"
# → 200 image/gif

curl -i "https://tracking.voxtn.com/click/test-message-1?u=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("https://example.com"))')"
# → 301 location: https://example.com
```

Then check `tracking_events` on the nexamail Postgres to see the rows, or subscribe via Socket.io to `wss://ai.nexamail.voxtn.com/socket.io/` and listen for `tracking_event`.
