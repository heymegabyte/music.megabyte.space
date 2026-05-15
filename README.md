# Panda Desiiignare — `music.megabyte.space`

bZ's Web Audio music experience. Click anywhere on the screen; every region plays a different track. Visualizers, karaoke, Chromecast, Hue lighting, and an in-app AI DJ. Vanilla TypeScript + Vite, served by a Cloudflare Worker.

Production: <https://music.megabyte.space>

---

## Quick start

```bash
npm install
npm run dev           # vite dev server on http://localhost:5173
npm run build         # tsc -b && vite build (also regenerates OG cards)
npm run preview       # local preview of the built bundle
npm test              # vitest — pure-module unit tests (sub-second)
npm run test:e2e      # Playwright suite (defaults to PROD_URL)
npm run typecheck     # tsc -b --noEmit
npm run format:check  # prettier --check
```

Deploy is a single command (uses `wrangler.toml`):

```bash
npx wrangler deploy
```

After deploy, purge the zone cache so SEO rewriting + static HTML pick up the new bundle.

---

## Repository layout

```
src/                  # browser bundle (entry: src/main.ts)
  main.ts             # app shell, transport, UI wiring (large — owns the DOM)
  ai-chat.ts          # AI DJ drawer (streaming Claude Haiku via /api/ai/chat)
  audio.ts            # <audio> engine, playback queue, persistence
  visualizer.ts       # Web Audio FFT visualizers
  cast.ts             # Chromecast sender
  cast-protocol.ts    # custom-receiver protocol shim
  hue.ts              # Hue Play Light Bar BLE + CLIP gradient driver
  data.ts             # tracks + albums (source of truth for content)
  bear-data.ts        # Ashton letter data
  track-meta.ts       # per-route SEO metadata (consumed by worker)
  tags.ts             # semantic tagger (mood/theme/place/genre)
  palette.ts          # cover-art color extraction
  pip.ts              # picture-in-picture mini player
  spotify-connect.ts  # Spotify Connect handoff
  lyrics.ts           # whisper-word timing utilities
  embed.ts            # iframe-only entry (embed.html)
  style.css           # all styles (one file by design)
worker/               # Cloudflare Worker (entry: worker/index.ts)
  index.ts            # SEO rewriting, /api/*, audio + lyrics edge cache
  web-push.ts         # VAPID push fan-out
public/               # static assets (audio/, art/, og/, video/)
scripts/              # node CLI helpers (OG generation, lyric sync, drop broadcast)
tests/                # Playwright E2E (journey, embed, cast)
cast-receiver/        # Chromecast receiver app (App ID 228565CB)
ashton-letter/        # /ashton SPA child entry
```

Four Vite entry points compile to four HTML pages: `/`, `/embed/*`, `/ashton/*`, `/cast-receiver/`.

---

## Architecture at a glance

| Concern                 | Where                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| App shell + transport   | `src/main.ts`                                                                                  |
| Audio engine + queue    | `src/audio.ts` (single `<audio data-engine="bz">` element survives all internal nav)           |
| Per-route SEO rewriting | `worker/index.ts` `MetaRewriter` + `JsonLdRewriter` driven by `src/track-meta.ts`              |
| Email + push subscribe  | `POST /api/subscribe` → Listmonk + KV-backed VAPID record                                      |
| AI DJ                   | `POST /api/ai/chat` proxies Anthropic Claude Haiku 4.5 streaming                               |
| Audio edge cache        | Worker buffers `/audio/*` once into Cache API, serves Range slices with `Accept-Ranges: bytes` |
| Stats                   | KV counters `play:<id>` / `share:<id>`, exposed at `/api/stats`                                |

The audio element is owned by the parent document and never torn down on internal navigation. Subroutes like `/ashton`, `/embed/...`, and `/canopy/<track>` are served as the same SPA shell (worker rewrites the request internally) so playback continues across in-page navigation.

---

## Environment

Worker bindings (declared in `wrangler.toml`):

- `ASSETS` — static assets
- `COUNTERS` — KV namespace for plays/shares + rate-limit tokens + Listmonk list cache + push subscriptions

Secrets (set via `wrangler secret put`):

- `ANTHROPIC_API_KEY` — `/api/ai/chat`
- `ANTHROPIC_MODEL` _(optional)_ — defaults to `claude-haiku-4-5-20251001`
- `LISTMONK_API_TOKEN` — paired with the `[vars]` user
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_JWK`, `VAPID_SUBJECT` — web push
- `PUSH_ADMIN_TOKEN` — Bearer gate on `/api/push/send`

---

## Tests

Two layers:

- **Vitest** (`npm test`) — pure-module unit tests for `src/lyrics.ts`, `src/tags.ts`, `src/web-share.ts`, and `worker/web-push.ts`. Node environment, no DOM, sub-second loop. Coverage via `npm run test:coverage`.
- **Playwright** (`npm run test:e2e`) — end-to-end against `PROD_URL` (defaults to <https://music.megabyte.space>) at 6 breakpoints.

```bash
PROD_URL=http://localhost:4173 npm run test:e2e
```

Playwright tests start at the homepage and navigate like a real user — never `page.goto` directly to internal routes unless asserting per-route SEO.

CI runs typecheck + Prettier + Vitest + Vite build on every PR via `.github/workflows/ci.yml`.

---

## Conventions

- **Audio survives navigation.** Never tear down `<audio data-engine="bz">` on a route change. SPA-only routing is enforced by the worker.
- **Per-route metadata is server-rendered**, not client-injected. Add new routes in `src/track-meta.ts`; the worker's `MetaRewriter` replaces title + meta + JSON-LD before the HTML reaches the client.
- **No build-time templating.** `index.html` is a static shell; all DOM is built in `src/main.ts`.
- **One CSS file.** `src/style.css` is intentionally monolithic and uses cascade layers (`@layer reset, base, components, utilities`).
- **TypeScript is strict.** `tsc -b` runs on every build.

---

## Operational notes

- **Stats reset.** KV counters are append-only; resetting requires `wrangler kv key delete --binding=COUNTERS <key>`.
- **Cache purge after deploy.** Static HTML is `max-age=300`; audio + art are `immutable`. Use the Cloudflare dashboard or `curl` against `/client/v4/zones/<zone>/purge_cache` after a content drop.
- **Listmonk list auto-discovery.** First subscribe call resolves (or creates) the list named in `LISTMONK_LIST_NAME` and caches its id in KV for a week.

See `docs/` for deeper notes on architecture, deployment, and testing.
