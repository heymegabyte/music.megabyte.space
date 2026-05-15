# Development

Day-to-day work on `music.megabyte.space` — what to run, where to look, and the rough shape of a change.

## Prerequisites

- Node 20+ (Vite 6 + `tsc -b` require it).
- A Cloudflare account already wired to this project for `npm run deploy`. Local dev does not need Wrangler login.
- `npm install` once — pulls Vite, Playwright, Prettier, `@cloudflare/workers-types`.

The `prebuild` step generates per-track OG cards from `src/data.ts`. It needs `sharp` (already a dependency) and the source artwork in `public/art/`. Failures are fatal for `npm run build`; ignore the prebuild only when you've intentionally not changed cover art.

## Secrets for local dev

Copy `.dev.vars.example` to `.dev.vars` and fill in any secrets the surface you're touching needs. The file is gitignored. Production values live in Cloudflare (`npx wrangler secret put <NAME>`); the example file is the single source of truth for what exists.

Without a `.dev.vars`, the worker still boots — the affected endpoints return `503 *_not_configured` instead of crashing. See `docs/security.md` for the full secret list and trust boundaries.

## Commands

| Command                 | What it does                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm run dev`           | Vite dev server at `http://localhost:5173`. HMR for `src/`. Worker is NOT in the loop — `/api/*` calls 404. |
| `npm run typecheck`     | `tsc -b --noEmit`. Strict mode; do not disable.                                                             |
| `npm run build`         | Generates OG cards → `tsc -b` → `vite build` → `dist/`.                                                     |
| `npm run preview`       | Serves the `dist/` build at `:4173`. No Worker; for static HTML inspection.                                 |
| `npm run format`        | Prettier write across all source.                                                                           |
| `npm run format:check`  | Prettier verify; safe for CI.                                                                               |
| `npm test`              | Vitest — pure-module unit tests, Node env, sub-second.                                                      |
| `npm run test:watch`    | Vitest in watch mode.                                                                                       |
| `npm run test:coverage` | Vitest with v8 coverage; HTML report in `coverage/`.                                                        |
| `npm run test:e2e`      | Playwright against `PROD_URL` (defaults to production — set it before running locally).                     |
| `npx wrangler dev`      | Worker + assets locally at `:8787`. Use this when touching `worker/index.ts` or `/api/*`.                   |
| `npx wrangler deploy`   | Ship the worker. Purge the CF zone afterward.                                                               |

## Where to make changes

| Surface               | File                                                       |
| --------------------- | ---------------------------------------------------------- |
| Tracks & albums       | `src/data.ts`                                              |
| Per-route SEO         | `src/track-meta.ts`                                        |
| Transport / app shell | `src/main.ts` (large; search before scrolling)             |
| AI DJ drawer          | `src/ai-chat.ts`                                           |
| Visualizer            | `src/visualizer.ts`                                        |
| Cast sender           | `src/cast.ts` + `src/cast-protocol.ts`                     |
| Cast receiver         | `cast-receiver/`                                           |
| Worker / API          | `worker/index.ts`                                          |
| Push VAPID + AES-GCM  | `worker/web-push.ts`                                       |
| Push client lifecycle | `src/web-push.ts`                                          |
| Styles                | `src/style.css` (one file, cascade-layered — do not split) |

## Adding a track

1. Drop the mp3 into `public/audio/`.
2. Drop the cover into `public/art/`.
3. Append a `Track` to `TRACKS` in `src/data.ts`. The `id` becomes the URL slug.
4. (Optional) Drop `public/lyrics/<id>.lrc` for synced karaoke. Without it, the static `lyrics[]` array is used and timestamps are spread evenly across the audio duration.
5. `npm run build` regenerates the OG card. Visually verify `public/og/track-<id>.jpg` exists.
6. `npm run test:e2e -- --grep "per-route"` to confirm the SEO rewriter picks up the new route.

## Adding a Worker route

1. Add the route inside `worker/index.ts`. Keep the pattern of validating inputs (`/^[a-z0-9-]{1,80}$/` for track IDs, the email regex for addresses) and rate-limiting via `rateLimited()`.
2. Lock `Access-Control-Allow-Origin` to `https://music.megabyte.space` unless the endpoint is intentionally public (e.g. oEmbed).
3. If the new path is an internal SPA route, add it to the `run_worker_first` list in `wrangler.toml` and to the `MetaRewriter` map in `src/track-meta.ts`.
4. `npx wrangler dev` to test. Hit it from `curl` first; once the JSON shape is right, wire the UI.

## Style + lint

- Prettier is the only formatter. Run `npm run format` before committing.
- There is no ESLint. Introducing it would churn the source; if you add it, do it in a dedicated PR with autofix-only rules.
- `src/data.ts` and `src/bear-data.ts` are excluded from Prettier — they are hand-curated and reformatting causes huge diffs.

## Debugging the SPA-only routing

Internal routes (`/canopy/<track>`, `/halo/...`, `/appeal`, `/ashton`) are served by `env.ASSETS.fetch(new URL('/', ...))` in `worker/index.ts:826-832`. If a new internal route 404s, register it in `wrangler.toml`'s `run_worker_first` list AND map it in `MetaRewriter`. Direct visits to that path must boot the same shell — never put a real HTML file at one of these paths.

## Common pitfalls

- **Tearing down `<audio>` on navigation.** The element is created once in `src/audio.ts`. Any re-render that removes it kills the playing session. Replace the `#app` subtree, not the document.
- **Client-injected meta tags.** Crawlers see the server-rendered HTML; client-side `document.title = ...` is invisible to them. All crawlable metadata lives in `src/track-meta.ts`.
- **Adding a UI framework.** The project is intentionally vanilla. Don't introduce React/Vue/Angular — it inflates the bundle and breaks the audio-element ownership model.
- **Splitting `src/style.css`.** Cascade-layer order is load-bearing. If you must split, plan the extraction first and keep one PR per concern.
