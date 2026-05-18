# CLAUDE.md — agent guide for `music.megabyte.space`

Brief for AI agents working in this repository. Read this first.

## What this is

bZ's music site at <https://music.megabyte.space>. Vanilla TypeScript + Vite bundle served by a Cloudflare Worker (`worker/index.ts`). The Worker handles SEO rewriting, the `/api/*` surface, and edge caching for `/audio/*` + `/lyrics/*`.

The app is a single-page experience. The audio element is created once and persists across all internal navigation — never tear it down on a route change.

## Stack

- **Frontend:** vanilla TypeScript + Vite v6, no UI framework
- **Backend:** Cloudflare Worker + Wrangler v4
- **State:** KV namespace `COUNTERS` (plays, shares, rate limits, push subs, listmonk cache)
- **Tests:** Playwright v1.59 E2E, 6 breakpoints, runs against `PROD_URL`
- **Deploy:** `npx wrangler deploy` then purge the CF zone

## Where to make changes

| Task | File |
| --- | --- |
| New track or album | `src/data.ts` |
| Per-route SEO / OG tags | `src/track-meta.ts` (consumed by `worker/index.ts`) |
| Transport UI / app shell | `src/main.ts` (large; search first) |
| AI DJ drawer | `src/ai-chat.ts` |
| AI chat widget kinds + renderer | `src/ai-widgets.ts` (see [`docs/ai-chat-widgets.md`](./docs/ai-chat-widgets.md)) |
| `/shortcommands` palette builder | `src/ai-shortcommands.ts` (see [`docs/ai-chat-commands.md`](./docs/ai-chat-commands.md)) |
| Visualizer | `src/visualizer.ts` |
| Worker route or API | `worker/index.ts` |
| Styles | `src/style.css` (one file, cascade-layered) |

## Hard rules

1. **Audio persistence.** `<audio data-engine="bz">` is created in `src/audio.ts` and owned by the top-level document. Any change that tears it down on navigation is a regression.
2. **SPA-only routing.** Routes like `/canopy/<track>`, `/halo/...`, `/appeal`, `/ashton` are served by `env.ASSETS.fetch(new URL('/', ...))` so the same shell boots. Don't add a real HTML file at those paths.
3. **Per-route metadata is server-rendered.** Add metadata in `src/track-meta.ts` so `MetaRewriter` in `worker/index.ts` rewrites `<head>` at the edge. Never inject `<title>`/`<meta>` from client-side JS for crawlable content.
4. **TypeScript strict is on.** `tsc -b` runs in `npm run build`. Don't disable strict; add types instead.
5. **Tests start at the homepage.** Real-user flows — click through to the feature; don't `page.goto` an internal route unless the test specifically asserts per-route SEO.

## Workflow

```bash
npm run dev           # local dev (vite, http://localhost:5173)
npm run build         # tsc -b && vite build (regenerates OG cards via prebuild)
npm run test:e2e      # Playwright against PROD_URL
npx wrangler deploy   # ship the worker + assets
```

After deploy: purge the CF zone (`/client/v4/zones/<zone>/purge_cache`) so the rewritten HTML hits clients immediately.

## Secrets

Worker reads secrets from `wrangler secret put`:

- `ANTHROPIC_API_KEY` — required for `/api/ai/chat`
- `LISTMONK_API_TOKEN` — required for `/api/subscribe`
- `VAPID_*` + `PUSH_ADMIN_TOKEN` — required for `/api/push/*`

Local dev uses `.dev.vars` (gitignored).

## Conventions specific to this repo

- **Lyrics:** Christian-gangster ethic. Zero drug references. See `~/.claude/projects/-Users-apple-emdash-projects-music-megabyte-space/memory/feedback_lyrics_christian_gangster.md`.
- **Cast:** default receiver (`CC1AD845`) until the custom receiver is device-bound. Custom App ID `228565CB` lives in `src/cast-protocol.ts`.
- **Karaoke overlay:** word highlighting mirrors the fullscreen lyrics pattern in `src/main.ts` (parallel arrays `karaokeOverlayWords` + `karaokeOverlayWordSpans` + `karaokeOverlayWordIdx`, driven by the existing `startKaraoke` tick loop).
- **AI chat widgets:** assistant messages can carry typed `AiChatWidget[]` payloads — track-card, album-card, command-palette, citation, alert, code-snippet, etc. The renderer in `src/ai-widgets.ts` is a pure HTML-string builder; every URL goes through `safeUrl()` and every string through `escapeHtml()`. Run `/shortcommands` (or `/sc`) in the chat panel to see every slash command as a grouped, clickable palette. Full reference: [`docs/ai-chat.md`](./docs/ai-chat.md), [`docs/ai-chat-widgets.md`](./docs/ai-chat-widgets.md), [`docs/ai-chat-commands.md`](./docs/ai-chat-commands.md).

## Don't

- Don't add a UI framework (React/Vue/Angular). The project is intentionally vanilla.
- Don't split `src/style.css` into many files; the cascade-layer order is load-bearing.
- Don't add a database or auth provider. The site is stateless beyond KV counters.
- Don't introduce ESLint with autofix in the same PR as feature work — the existing source has not been linted; do it once, separately.
