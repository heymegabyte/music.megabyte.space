# Testing

Two layers:

1. **Vitest** — pure-module unit tests, Node environment, sub-second loop. Configured in `vitest.config.ts`.
2. **Playwright** — end-to-end against a real URL at six breakpoints. Configured in `playwright.config.ts`.

CI (`.github/workflows/ci.yml`) runs typecheck + Prettier + Vitest + Vite build on every PR. Playwright stays on-demand because it targets a live URL.

## Unit tests (Vitest)

```bash
npm test             # one-shot
npm run test:watch   # watch mode
npm run test:coverage
```

Covered modules:

| File                      | Surface                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/lyrics.test.ts`      | LRC parser (precision, multi-timestamp, sort, malformed input), `activeLineIndex` binary search, `scaleStaticBundle` rescale math |
| `src/tags.test.ts`        | `TRACK_TAGS` shape invariants, `getTrackTags` lookup, `tracksByTag` cross-namespace match, `allTags` partitioning                 |
| `worker/web-push.test.ts` | `importVapidJwk` non-extractable contract, `sendPushBatch` per-endpoint failure isolation, expired-endpoint detection (404/410)   |
| `worker/escape.test.ts`   | `escapeXmlText` ampersand-first ordering for XML text content, `escapeHtmlAttr` quote+apostrophe escaping for `title="..."`        |
| `worker/json-ld.test.ts`  | `serializeJsonLd` script-tag breakout guard: `</`, `<!--`, U+2028, U+2029 escaped to valid JSON `\uXXXX` (round-trip preserved)    |
| `src/web-share.test.ts`   | `nativeShare` AbortError handling, `shareWithFallback` desktop/mobile branching, `canShareFiles` feature detection                 |

Tests must not import modules that touch `document`, `window`, `caches`, `AudioContext`, or `localStorage`. Those live under Playwright. If a pure module accidentally pulls in a DOM API, the test will fail at import time with `ReferenceError: document is not defined` — refactor the seam so the pure logic lives in its own file.

## End-to-end (Playwright)

`tests/journey.spec.ts` covers the user-facing flow end-to-end at six breakpoints (375 / 390 / 768 / 1024 / 1280 / 1920):

`tests/journey.spec.ts` covers the user-facing flow end-to-end at six breakpoints (375 / 390 / 768 / 1024 / 1280 / 1920):

1. **Home loads with no console errors.** Sanity gate — catches CSP misses, missing assets, and uncaught exceptions on first paint.
2. **Share chip row does not overlap the transport.** Regression test for the layout fix in commit `b76a2d0`.
3. **Install banner "Later" persists.** Dismissal writes to `localStorage`; banner stays hidden after reload.
4. **Seek bar click jumps audio.** Chromium-only (relies on `HTMLMediaElement` time tracking). Validates the single-audio invariant: same `<audio>` element after the click.
5. **Per-route metadata is unique.** Navigates to a track page and asserts `<title>` differs from `/`. Proves the worker `MetaRewriter` is running.
6. **Share dialog opens from row chip.** Click-through coverage for the share UI.
7. **Notify modal rejects bad email.** API call is mocked; validates client-side regex before submit.

Every test starts at the homepage and clicks through. No `page.goto('/some-route')` unless the test specifically asserts per-route SEO.

### Running Playwright locally

```bash
PROD_URL=https://music.megabyte.space npm run test:e2e          # against prod
PROD_URL=http://localhost:5173    npm run test:e2e              # against dev (npm run dev in another shell)
PROD_URL=http://localhost:8787    npm run test:e2e              # against wrangler dev (covers worker)
```

`playwright.config.ts` reads `PROD_URL` and applies it to all projects. Without it, the suite hits production.

To debug a single test:

```bash
npx playwright test tests/journey.spec.ts --grep "per-route" --headed --debug
```

## Adding a test

Append to `tests/journey.spec.ts`. Do not create new spec files unless the feature is genuinely orthogonal (Cast, push notifications, AI chat) — the journey file is a deliberate single-stream narrative.

Pattern:

```ts
test('feature does X', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'My CTA' }).click();
  await expect(page.locator('[data-testid="my-feature"]')).toBeVisible();
});
```

Selectors: prefer `getByRole`, `getByText`, `[data-testid]`. Avoid CSS-shape selectors — they break the moment a class name changes.

## Console + a11y

Playwright will fail the run if a test handler attaches a console listener and one fires. The home-loads test does exactly this. If you ship a third-party script that logs warnings, suppress with `page.removeAllListeners('console')` BEFORE the noisy event — never silence it globally.

There is no axe-core hook yet. If you add one, run it on `/` and one track page; do not gate every test on it (slow + noisy).

## Visual diff

Not configured. The `.verify-shots/` directory holds ad-hoc screenshots from manual passes (karaoke timing, appeal modal) — it is gitignored.

If you add Percy / Chromatic / pixelmatch, attach it to a separate workflow so the main E2E run stays fast.
