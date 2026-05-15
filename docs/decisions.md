# Architecture Decision Log

Short entries for irreversible-ish choices. Each entry states the decision, the context, and the alternatives we rejected.

---

## ADR-001 — Vanilla TypeScript, no UI framework

**Decision.** The frontend is plain TypeScript modules + DOM APIs. No React, Vue, Angular, Svelte, Solid.

**Why.** The app is a single-page music player. The hardest invariant — one `<audio>` element owned across all internal navigation — is easier to enforce when there is no virtual DOM trying to re-create it on every render. A framework would also blow the bundle past the JS budget on a site that needs to start playing audio within 2 seconds.

**Rejected.** React would have made the AI chat drawer a few lines shorter but would require state managers, refs, and a careful escape hatch to keep `<audio>` outside the React tree.

---

## ADR-002 — Single Worker, edge-side HTML rewriting

**Decision.** One Cloudflare Worker handles SEO rewriting (`HTMLRewriter`), `/api/*`, and edge-cached `/audio/*` + `/lyrics/*`. The same Worker serves the static `dist/` bundle via the `ASSETS` binding.

**Why.** Per-route metadata has to be in the served HTML for crawlers. Either we (a) pre-render every route at build time, doubling the deploy surface, or (b) rewrite at the edge. Edge-rewriting keeps `dist/` to a single `index.html` and lets the data live in `src/track-meta.ts` — one source of truth.

**Rejected.** Pre-rendering with a static-site framework would force every album/track addition to be a code change + deploy, and would force the OG card generator to run inside the framework. Keeping it as a Vite prebuild script is simpler.

---

## ADR-003 — SPA-only internal routing

**Decision.** Internal routes (`/canopy/<track>`, `/halo/...`, `/appeal`, `/ashton`) are rewritten by the Worker to fetch the root `index.html`. The client router replaces the `#app` subtree.

**Why.** The single-audio invariant requires that no internal navigation reloads the document. Direct hits to a deep link must boot the same shell so the audio engine survives.

**Rejected.** Multiple HTML entrypoints (one per route) would duplicate the boot logic and risk re-creating `<audio>` on navigation.

**Operational note.** Adding a new internal route means registering it in `wrangler.toml`'s `run_worker_first` list AND mapping it in `MetaRewriter` in `worker/index.ts`. Forgetting either causes a 404 or stale metadata.

---

## ADR-004 — Worker-cached audio with Range slicing

**Decision.** The Worker pulls full MP3s from `ASSETS` into Cache API, then serves Range requests from that buffer. Same pattern for `/lyrics/*.json`.

**Why.** Three reasons:

1. Shaka Player on the Chromecast receiver needs `Access-Control-Allow-Origin: *` AND `Timing-Allow-Origin: *`. `ASSETS` doesn't ship those.
2. `env.ASSETS.fetch` occasionally returns 503 under cold-start pressure. The Worker absorbs it with exponential backoff (75 → 225 → 675 ms) and only propagates a synthetic 503 with `Retry-After: 5` after three failures.
3. Range slicing from an in-memory buffer is trivial; the audio engine and Shaka both rely on 206 responses for seek.

**Rejected.** Letting `ASSETS` serve audio directly would simplify the worker but break Chromecast and surface origin flakes to the user mid-playback.

---

## ADR-005 — KV-only persistence

**Decision.** No D1, no Durable Objects, no third-party database. Counters and rate-limits live in the `COUNTERS` KV namespace; email subscribers are deduplicated against Listmonk + hashed in KV.

**Why.** The app has no user accounts and no transactional state. KV is eventually consistent but that is acceptable for play/share counts. Adding D1 would gain query power we don't need and require a migration story we'd rather not own.

**Rejected.** D1 was considered for time-series play data. Decision: if/when we want analytics, ship to Cloudflare Analytics Engine — not a SQL store.

---

## ADR-006 — Single CSS file with cascade layers

**Decision.** All styles live in `src/style.css`. Native nesting, native cascade layers (`@layer reset, base, components, utilities`), no preprocessor.

**Why.** Cascade-layer order is load-bearing for the visualizer + transport. Splitting the file fragments the layer declaration and invites specificity bugs. Modern CSS handles the rest of what a preprocessor used to do.

**Rejected.** Tailwind would shrink the file but the visualizer + Lottie + cast-receiver UI all need bespoke selectors. CSS-in-JS would couple styles to the framework we don't have.

---

## ADR-007 — Hand-curated data, no generated files

**Decision.** `src/data.ts` and `src/bear-data.ts` are hand-edited. No build step generates them, and both are excluded from Prettier.

**Why.** The artist controls the catalogue. A generator would imply a CMS or a YAML source we don't have. Excluding them from Prettier prevents formatter churn from producing huge unrelated diffs.

**Rejected.** Moving to a headless CMS would add a dependency that fails offline. Generating from YAML was rejected as a layer of indirection with no payoff for one author.

---

## ADR-008 — Default Cast receiver until custom is device-bound

**Decision.** `src/cast-protocol.ts` declares both `CAST_APP_ID = '228565CB'` (custom) and `RECEIVER_FALLBACK = 'CC1AD845'` (Default Media Receiver). Until the custom receiver is bound to the user's device through the Cast Console, the sender uses the fallback.

**Why.** Selecting an unbound App ID surfaces "select unknown ID" + silent sender. The fallback always works; the custom App ID is the upgrade path once Brian publishes from the Cast Console.

**Rejected.** Forcing the custom App ID would brick Cast for everyone except registered dev devices.

**Reference.** `feedback_cast_default_receiver_first.md` in memory.

---

## ADR-009 — TypeScript strict, `noUnusedLocals: false`

**Decision.** `tsconfig.json` uses strict mode. We do NOT enable `noUnusedLocals` or `noUnusedParameters`.

**Why.** The existing source has accumulated unused locals (especially in `main.ts`) that are not bugs — they're scaffolding for upcoming features. Enabling the flag would force either deletion (loses intent) or `// @ts-expect-error` (noisier than the locals themselves).

**Rejected.** A one-time cleanup pass is in the backlog but is scoped out of every feature PR to keep diffs reviewable.

---

## ADR-010 — Vitest for pure modules, Playwright for everything else

**Decision.** Two-layer test strategy. Vitest covers pure-module logic with no DOM or Worker runtime: `src/lyrics.ts`, `src/tags.ts`, `src/web-share.ts` (the cancel-vs-fallback contract), and `worker/web-push.ts` helpers (`importVapidJwk`, `sendPushBatch` per-endpoint isolation). Playwright covers DOM, navigation, audio playback, AI chat streaming, and per-route SEO — all the interesting end-user surface.

**Why.** The pure modules are the load-bearing utilities: a regression in `parseLrc` or `activeLineIndex` silently breaks every karaoke session. A regression in `sendPushBatch` error-isolation could quietly drop notifications for a whole batch. Sub-second unit tests catch those before they reach Playwright, where a failure costs 30s+ to surface.

**Rejected.** Stand-alone integration test for the Worker via `wrangler dev` + `node:test`. Added complexity for a surface that Playwright already exercises end-to-end through `/api/*`.

**Operational note.** Vitest runs in Node (no jsdom). Tests must not import modules that touch `document`, `window`, or `caches`. CI runs `npm test` + `npm run typecheck` + `npm run format:check` + `npm run build` on every PR.
