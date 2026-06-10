# Security

Trust boundaries, secret handling, and the assumptions behind the worker's API surface.

## Threat model

The site is a public music player. There is no user auth, no PII storage, no payments. The valuable assets are:

- The `ANTHROPIC_API_KEY` (could be drained via abuse of `/api/ai/chat`).
- The `LISTMONK_API_TOKEN` (could be used to send mail from the bZ list).
- The `VAPID_PRIVATE_JWK` (could be used to send rogue push notifications to subscribers).
- The `PUSH_ADMIN_TOKEN` (gates `/api/push/send`; leaking it = same risk).
- KV counters (play / share counts; integrity risk only — not catastrophic).
- The static asset bundle (defacement risk — managed by Cloudflare ASSETS).

Everything else is non-sensitive: track metadata, lyrics, OG cards, and the audio files themselves are publicly distributed by design.

## Trust boundary

The worker treats every request body as untrusted. The patterns to follow when adding new endpoints:

- **Track IDs** are validated against `/^[a-z0-9-]{1,80}$/` AND looked up in `TRACK_BY_ID.has(...)` before any KV write. Both checks — regex prevents path injection, the map check prevents counter-pollution on unknown IDs.
- **Email addresses** are normalized (`trim().toLowerCase()`), bounded at 254 characters (the RFC max), and matched against a conservative regex. The email is then SHA-256-hashed before becoming a KV key (`email:<sha256>`) so we never store plaintext addresses at rest.
- **AI chat messages** are filtered to `{role: 'user' | 'assistant', content: string}`, each content string truncated to 8000 characters, the array capped at 20 messages. Anything else is rejected with a 400.
- **Push endpoints** must start with `https://`. Anything else is dropped — protects against malformed `PushSubscription` payloads being persisted.
- **`/api/push/send`** requires a Bearer token (`PUSH_ADMIN_TOKEN`). The token value is compared with constant-time semantics; never logged.

`Access-Control-Allow-Origin` is locked to `https://music.megabyte.space` on every API response. The single exception is `/api/oembed`, which is intentionally `*` because oEmbed consumers (Slack, Discord, blog post unfurlers) come from arbitrary origins.

## Rate limiting

KV-backed, IP-scoped, per-scope. Helper: `rateLimited(kv, ip, scope, id, ttlSec)` at `worker/index.ts:46`. Current scopes:

| Scope             | TTL    | Purpose                                              |
| ----------------- | ------ | ---------------------------------------------------- |
| `play`            | 1800 s | One play per IP per 30 min per track                 |
| `share`           | 60 s   | Anti-spam on `/api/share/<id>`                       |
| `subscribe`       | 60 s   | Per-IP cooldown on `/api/subscribe`                  |
| `subscribe-email` | 120 s  | Per-email-hash cooldown on `/api/subscribe`          |
| `push-sub`        | 30 s   | Per-IP cooldown on `/api/push/subscribe`             |
| `ai-chat`         | 6 s    | Per-IP cooldown on `/api/ai/chat`, prevents tab-spam |

Throttled requests get `429` with `{ "error": "throttled" }` and the current counter where applicable so the UI can re-sync without re-fetching.

## Headers

The worker sets the security baseline at the edge. Inventory (do not weaken without a recorded reason):

- `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` locks down camera, microphone, geolocation, etc.
- `Content-Security-Policy` — nonce-based on the inline boot script.

`X-XSS-Protection` and `Expect-CT` are intentionally NOT set; both are deprecated.

## Secrets handling

- All secrets live in Wrangler. Set with `wrangler secret put`; never hard-code, never commit.
- Local development uses `.dev.vars` (gitignored). It is the only file that ever contains plaintext secrets on disk.
- The worker never returns a secret in a response, even on error. The Anthropic stream proxy unwraps its response body and re-emits only the `text` delta; the upstream auth header is invisible to the client.
- Push admin requests use a Bearer token compared by string equality after both sides are trimmed. Token rotation: `wrangler secret put PUSH_ADMIN_TOKEN`, then update the caller (CI cron, ops script).

## CORS specifics

`/api/oembed` returns `Access-Control-Allow-Origin: *` because OEmbed clients are arbitrary. The endpoint is read-only and returns no user-specific data. Audio/lyrics edge caches also return `Access-Control-Allow-Origin: *` + `Timing-Allow-Origin: *` because Shaka Player on the Chromecast receiver requires both — this is the reason the worker proxies these assets at all instead of letting `ASSETS` serve them directly.

## What we do NOT do (and why)

- **No DOMPurify / sanitizer.** No user-generated content is rendered. Lyrics, vibes, wisdom — all author-curated in `src/data.ts`.
- **No CSRF tokens.** No mutating endpoints depend on cookie auth. The push admin token is the only mutation surface, and it's a Bearer header.
- **No database.** KV counters + Listmonk are the only persistence. No SQL means no SQL injection class.
- **No file uploads.** No multipart parsing, no temp-file handling, no upload size limits to worry about. Web Share API file flow is client-side only.

## When you add an endpoint

The checklist:

1. Validate every input. Pattern + bounds + cardinality.
2. Decide on a rate-limit scope and TTL. New scope → add to the table above.
3. CORS: lock to the production origin unless there's a documented public-consumer reason.
4. Logging: errors only. Never log full bodies that could contain secrets or PII.
5. Failure path: return 4xx with a tight `{error, code?}` envelope. 5xx only for genuine server faults.

## Known soft spots

- The HTMLRewriter applies `escapeText` to user-derived strings before `setInnerContent`. HTMLRewriter likely escapes its own argument, which may result in double-encoding for `&`, `<`, `>` in titles. Behavior currently looks correct because every track title is plain ASCII; if someone adds a title with `&` or `<`, audit before shipping.
- The IP source is `cf-connecting-ip`. If the worker is ever fronted by another proxy, that header becomes spoofable — switch to `cf-pseudo-ipv4` or a verified upstream.
