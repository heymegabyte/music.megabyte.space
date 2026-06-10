# Architecture

A field guide to the runtime, the worker, and the assumptions baked into both.

## Runtime shape

```
┌──────────────────────────────── browser ────────────────────────────────┐
│  index.html  (static shell, server-rewritten <head> per route)          │
│      └─ /src/main.ts                                                    │
│            ├─ <audio data-engine="bz">   ← owned for life of session    │
│            ├─ visualizer.ts canvas       ← FFT off the same audio       │
│            ├─ ai-chat.ts drawer          ← streams /api/ai/chat (SSE)   │
│            ├─ cast.ts + cast-protocol.ts ← Chromecast sender            │
│            └─ hue.ts                     ← BLE / CLIP v2 gradients      │
└────────────────────────────────────────────────────────────────────────┘
                    │                                ▲
                    │  fetch /api/*, /audio/*, /lyrics/*
                    ▼                                │
┌────────────────────── Cloudflare Worker ──────────────────────┐
│  worker/index.ts                                              │
│    ├─ SEO HTMLRewriter (title, OG, JSON-LD per route)         │
│    ├─ /api/oembed, /api/play, /api/share, /api/stats          │
│    ├─ /api/subscribe (Listmonk + KV push record)              │
│    ├─ /api/ai/chat   (Anthropic Claude Haiku 4.5 SSE proxy)   │
│    ├─ /api/push/*    (VAPID web push fan-out)                 │
│    ├─ /api/hue/discover (Hue meethue.com discovery proxy)     │
│    ├─ /audio/* edge cache + Range slicing                     │
│    └─ /lyrics/*.json edge cache + 3-attempt retry             │
│                                                               │
│  Bindings: ASSETS (static), COUNTERS (KV)                     │
└───────────────────────────────────────────────────────────────┘
```

## The single-audio invariant

The transport owns one `<audio>` element. Every feature — visualizer, karaoke, cast, hue, AI chat now-playing — reads `audio.currentTime` from that element. Routes are switched by replacing the `#app` subtree, not by reloading the document.

Three places enforce this:

1. **Worker** rewrites internal subroutes to fetch the same `/` shell (`worker/index.ts:826-832`).
2. **`src/audio.ts`** creates the element once on boot and persists state to `localStorage`.
3. **Playwright `journey.spec.ts`** asserts seek-and-play across the full flow.

If you add a new internal route, register it in `wrangler.toml`'s `run_worker_first` list and route it to the same shell.

## Per-route SEO

`src/track-meta.ts` exports `SEO_INDEX: Record<string, RouteSeo>`. The worker reads this map, matches the request pathname, and feeds the entry to three `HTMLRewriter` consumers:

- **`MetaRewriter`** swaps `<title>`, `<meta name=...>`, `<meta property=og:...>`, twitter cards, and `<link rel=canonical>`.
- **`JsonLdRewriter`** replaces the first `<script type="application/ld+json">` in the document with the route's stack (then removes any later ones).
- **`SeoBodyRewriter`** appends a `<details>About this page</details>` block inside `<body>` so crawlers index 300-1000 word per-route narratives.

This is a no-cloak setup — the same HTML reaches users and bots; the prose is just visually collapsed.

## Audio edge-cache

Cloudflare Assets is the origin for `/audio/*`. The worker pulls the full MP3 once into Cache API, then serves Range requests from that buffer. Three reasons:

1. **CORS for Chromecast.** Shaka Player on the cast receiver requires `Access-Control-Allow-Origin: *` plus `Timing-Allow-Origin: *`. ASSETS doesn't ship those.
2. **503 absorption.** `env.ASSETS.fetch` occasionally returns 503 under cold-start pressure. The worker retries with exponential backoff (75 → 225 → 675 ms) before propagating a synthetic 503 with `Retry-After: 5`.
3. **Range slicing.** Once the buffer is in cache, slicing is trivial; the audio engine and Shaka both rely on `206` responses for seek.

The same pattern applies to `/lyrics/*.json` — the karaoke renderer has no graceful fallback for a 503 mid-playback, so the worker retries before giving up.

## Rate limiting

KV-based, IP-scoped, scope-scoped. The helper is `rateLimited(kv, ip, scope, id, ttlSec)` in `worker/index.ts:46`. Current scopes:

| Scope             | TTL    | Endpoint                                                |
| ----------------- | ------ | ------------------------------------------------------- |
| `play`            | 1800 s | `/api/play/<id>` (one play per IP per 30 min per track) |
| `share`           | 60 s   | `/api/share/<id>`                                       |
| `subscribe`       | 60 s   | `/api/subscribe` (per IP)                               |
| `subscribe-email` | 120 s  | `/api/subscribe` (per email hash)                       |
| `push-sub`        | 30 s   | `/api/push/subscribe`                                   |
| `ai-chat`         | 6 s    | `/api/ai/chat` (per IP, prevents tab-spam)              |

Throttled requests return 429 with `{ "error": "throttled" }` and (where applicable) the current counter so the client doesn't desync.

## Trust boundary

The worker treats every request body as untrusted. Specifically:

- Track IDs are validated against `/^[a-z0-9-]{1,80}$/` _and_ checked against `TRACK_BY_ID.has(...)` before any KV write.
- Email is normalized (`trim().toLowerCase()`), bounded at 254 chars, and matched against a conservative regex.
- AI chat messages are filtered to `{role: 'user'|'assistant', content: string}`, truncated to 8000 chars each, capped at 20 messages.
- Push endpoints must start with `https://` (drops malformed PushSubscription payloads).
- `/api/push/send` requires a Bearer token (`PUSH_ADMIN_TOKEN`) that is never logged.

`Access-Control-Allow-Origin` is locked to `https://music.megabyte.space` on API responses (except oEmbed, which is intentionally `*` for unfurling).

## What lives in KV

```
play:<track-id>       → integer (play count)
share:<track-id>      → integer (share count)
rl:<scope>:<ip>:<id>  → '1' with TTL (rate-limit tokens)
push:<sha256(endpoint)> → JSON PushSubscriptionRecord (90-day TTL)
email:<sha256(email)>   → JSON subscriber attribution (365-day TTL)
listmonk:list-id      → integer (list id, 7-day TTL)
```

Counters are append-only; reset by deleting the key.

## Future hazards

- **`src/main.ts` and `src/style.css` are large by design.** Splitting them is not a free win; the cascade-layer order in CSS is load-bearing, and the IIFE shape of `main.ts` keeps a lot of state private. If you split, plan the extraction first and keep one PR per concern.
- **No build step generates `data.ts` or `bear-data.ts`.** They are hand-curated. Both are excluded from Prettier so reformatting doesn't churn the diff.
- **The cast receiver is published.** App ID `228565CB` is wired in `src/cast-protocol.ts`. If you change the receiver's URL, re-publish via the Google Cast Console first; the sender must default to `CC1AD845` until the new receiver is device-bound.
