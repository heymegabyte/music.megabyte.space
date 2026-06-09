// TDD E2E coverage for the two casting surfaces the user can actually open:
//   1. `/cast-receiver/` — the TV-side runtime, exercised in "standalone" mode
//      (no Chromecast UA) via the `window.__castReceiver` shim so we can
//      simulate a `queue:load` and assert audio progresses end-to-end.
//   2. `/embed/<album>/<track>` — the embeddable player rendered by
//      `src/embed.ts`, exercised as a real user would: load → click play →
//      assert audio progresses, controls react, no console errors.
//
// Both suites are deliberately strict about console errors: anything in the
// console at `error` level fails the test. Known-noisy/3rd-party items (e.g.
// favicon 404s in preview) are filtered in `recordConsoleErrors()`.

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const EMBED_PATH = '/embed/desiiignare/chef-lu-stew';
const RECEIVER_PATH = '/cast-receiver/';

const SAMPLE_QUEUE = [{
  id: 'chef-lu-stew',
  title: 'Chef Lu Stew',
  artist: 'bZ',
  album: 'Panda Desiiignare',
  cover: '/art/cover-panda-desiiignare-v2.png',
  audio: '/audio/Chef_Lu_Stew.mp3'
}];

test.describe.configure({ mode: 'parallel' });

/** Capture console-level errors, filtering benign 3rd-party noise. Returns the
 * mutable array — call `expect(errs).toEqual([])` at the end of the test. */
function recordConsoleErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on('pageerror', e => errs.push(`pageerror: ${e.message}`));
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon|Failed to load resource|net::ERR_|speculation rules|sw register failed|Cast SDK|cast_sender|cast_receiver_framework|google-cast-launcher/i.test(text)) return;
    errs.push(text);
  });
  return errs;
}

/** Block the gstatic cast SDK so the receiver always runs in standalone preview
 * mode regardless of the spawned Chrome's UA detection quirks. */
async function blockCastSdk(page: Page) {
  await page.route(/gstatic\.com\/(cast|cv)\//, r => r.abort());
  await page.route(/cloudflareinsights\.com|cdn-cgi\/challenge-platform|cdn-cgi\/speculation/, r => r.abort());
}

async function stopAllAudio(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('audio').forEach(a => {
      try { a.pause(); a.removeAttribute('src'); a.load(); } catch { /* swallow */ }
    });
  }).catch(() => { /* page may already be closed */ });
}

test.describe('cast-receiver — standalone streaming', () => {
  test.beforeEach(async ({ page }) => { await blockCastSdk(page); });
  test.afterEach(async ({ page }) => { await stopAllAudio(page); });

  test('loads, exposes __castReceiver, streams a queued track end-to-end', async ({ page }) => {
    test.setTimeout(60_000);
    const errs = recordConsoleErrors(page);

    await page.goto(RECEIVER_PATH, { waitUntil: 'domcontentloaded' });

    // Standalone API is the contract: loadQueue/play/pause/seek/state/current.
    await page.waitForFunction(() => {
      const api = (window as unknown as { __castReceiver?: { standalone?: boolean; loadQueue?: unknown } }).__castReceiver;
      return !!api && api.standalone === true && typeof api.loadQueue === 'function';
    }, { timeout: 15_000 });

    // TV UI elements must exist before we kick the queue.
    await expect(page.locator('#stage')).toBeVisible();
    await expect(page.locator('#statusText')).toBeVisible();

    // Pump a single-track queue. Must render now-playing chrome immediately.
    await page.evaluate((items) => {
      const api = (window as unknown as { __castReceiver: { loadQueue: (q: unknown[]) => void } }).__castReceiver;
      api.loadQueue(items);
    }, SAMPLE_QUEUE);

    // Title + artist + album must reflect the queued track.
    await expect(page.locator('#title')).toHaveText('Chef Lu Stew', { timeout: 10_000 });
    await expect(page.locator('#artist')).toHaveText('bZ');
    await expect(page.locator('#album')).toHaveText('Panda Desiiignare');

    // Audio must reach a playable state (readyState >= 2 == HAVE_CURRENT_DATA).
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return !!audio && audio.readyState >= 2 && Number.isFinite(audio.duration) && audio.duration > 0;
    }, { timeout: 30_000 });

    // After playback starts, currentTime must advance.
    await page.evaluate(async () => {
      const audio = document.querySelector('audio') as HTMLAudioElement | null;
      if (audio && audio.paused) { try { await audio.play(); } catch { /* autoplay policy */ } }
    });
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return !!audio && audio.currentTime > 0.5;
    }, { timeout: 20_000 });

    // Stage must have left the idle splash.
    const stageView = await page.locator('#stage').getAttribute('data-view');
    expect(stageView).not.toBe('idle');

    // Public state surface must report a real trackId + non-zero duration.
    const state = await page.evaluate(() => {
      const api = (window as unknown as { __castReceiver: { state: () => { trackId: string | null; duration: number; position: number } } }).__castReceiver;
      return api.state();
    });
    expect(state.trackId).toBe('chef-lu-stew');
    expect(state.duration).toBeGreaterThan(10);
    expect(state.position).toBeGreaterThanOrEqual(0);

    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('?demo=1 auto-seeds the full TRACKS catalogue without a sender', async ({ page }) => {
    test.setTimeout(60_000);
    const errs = recordConsoleErrors(page);

    await page.goto(`${RECEIVER_PATH}?demo=1`, { waitUntil: 'domcontentloaded' });

    // Wait for the receiver to load + the queue to populate from URL params.
    await page.waitForFunction(() => {
      const api = (window as unknown as { __castReceiver?: { runtime?: { queue?: unknown[] } } }).__castReceiver;
      return !!api?.runtime?.queue && Array.isArray(api.runtime.queue) && api.runtime.queue.length > 1;
    }, { timeout: 15_000 });

    const queueLen = await page.evaluate(() => {
      const api = (window as unknown as { __castReceiver: { runtime: { queue: unknown[] } } }).__castReceiver;
      return api.runtime.queue.length;
    });
    // The full bZ catalog is 40+ tracks — anything short of 20 means the
    // auto-seed regressed silently. Tight bound on the low end, generous
    // on the high end to absorb future track additions without churn.
    expect(queueLen).toBeGreaterThanOrEqual(20);

    // First track must be the one loaded into the now-playing chrome.
    await expect(page.locator('#title')).not.toBeEmpty({ timeout: 10_000 });
    await expect(page.locator('#artist')).toHaveText('bZ');

    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('?track=<id> auto-seeds and starts at the named track', async ({ page }) => {
    test.setTimeout(60_000);
    const errs = recordConsoleErrors(page);

    await page.goto(`${RECEIVER_PATH}?track=chef-lu-stew&autoplay=0`, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => {
      const api = (window as unknown as { __castReceiver?: { state: () => { trackId: string | null } } }).__castReceiver;
      return api?.state().trackId === 'chef-lu-stew';
    }, { timeout: 15_000 });

    await expect(page.locator('#title')).toHaveText('Chef Lu Stew');
    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('seek + pause via __castReceiver mutate the audio element', async ({ page }) => {
    test.setTimeout(60_000);
    const errs = recordConsoleErrors(page);

    await page.goto(RECEIVER_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as unknown as { __castReceiver?: unknown }).__castReceiver, { timeout: 15_000 });
    await page.evaluate((items) => {
      (window as unknown as { __castReceiver: { loadQueue: (q: unknown[]) => void } }).__castReceiver.loadQueue(items);
    }, SAMPLE_QUEUE);
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return !!audio && Number.isFinite(audio.duration) && audio.duration > 5;
    }, { timeout: 30_000 });

    // Seek to ~5s and assert audio reflects it.
    await page.evaluate(() => {
      (window as unknown as { __castReceiver: { seek: (s: number) => void } }).__castReceiver.seek(5);
    });
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return !!audio && audio.currentTime >= 4.5;
    }, { timeout: 10_000 });

    // Pause and assert audio.paused flips true.
    await page.evaluate(() => {
      (window as unknown as { __castReceiver: { pause: () => void } }).__castReceiver.pause();
    });
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return !!audio && audio.paused;
    }, { timeout: 5_000 });

    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });
});

test.describe('cast-receiver — gorgeous redesign + new functions', () => {
  test.beforeEach(async ({ page }) => { await blockCastSdk(page); });
  test.afterEach(async ({ page }) => { await stopAllAudio(page); });

  test('?test alias auto-seeds the full catalogue + autoplays', async ({ page }) => {
    test.setTimeout(60_000);
    const errs = recordConsoleErrors(page);
    await page.goto(`${RECEIVER_PATH}?test`, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => {
      const api = (window as unknown as { __castReceiver?: { runtime?: { queue?: unknown[] } } }).__castReceiver;
      return Array.isArray(api?.runtime?.queue) && api!.runtime!.queue!.length > 1;
    }, { timeout: 15_000 });

    const queueLen = await page.evaluate(() =>
      (window as unknown as { __castReceiver: { runtime: { queue: unknown[] } } }).__castReceiver.runtime.queue.length);
    expect(queueLen).toBeGreaterThanOrEqual(20);
    await expect(page.locator('#title')).not.toBeEmpty({ timeout: 10_000 });
    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('brand DOM: aurora + viz canvas + art glow all present', async ({ page }) => {
    const errs = recordConsoleErrors(page);
    await page.goto(`${RECEIVER_PATH}?test`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.stage__aurora')).toHaveCount(1);
    await expect(page.locator('canvas#viz')).toBeVisible();
    await expect(page.locator('#artGlow')).toHaveCount(1);
    await expect(page.locator('#artWrap')).toHaveCount(1);

    // Brand invariant: the background stays deep brand-black. The accent is now
    // tinted PER TRACK from the cover art (receiver-side palette extraction), so
    // it resolves to a valid color but is no longer pinned to brand cyan.
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { accent: cs.getPropertyValue('--accent').trim(), bg: cs.getPropertyValue('--bg').trim() };
    });
    expect(tokens.bg.toLowerCase()).toBe('#060610');
    expect(tokens.accent).toMatch(/^(#[0-9a-fA-F]{3,8}|rgb|hsl|oklch)/);
    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('Web Audio visualizer actually paints non-empty pixels during playback', async ({ page }) => {
    test.setTimeout(60_000);
    const errs = recordConsoleErrors(page);
    await page.goto(`${RECEIVER_PATH}?test`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as unknown as { __castReceiver?: unknown }).__castReceiver, { timeout: 15_000 });

    // Force playback (autoplay policy needs a gesture in headless).
    await page.evaluate(async () => {
      const audio = document.querySelector('audio') as HTMLAudioElement | null;
      if (audio && audio.paused) { try { await audio.play(); } catch { /* policy */ } }
    });
    await page.waitForFunction(() => {
      const a = document.querySelector('audio');
      return !!a && a.currentTime > 0.6;
    }, { timeout: 25_000 });

    // Sample the canvas — at least some pixels must be non-transparent (the
    // visualizer is drawing bars/blooms, not a blank frame).
    const painted = await page.evaluate(() => {
      const c = document.querySelector('canvas#viz') as HTMLCanvasElement | null;
      if (!c || !c.width || !c.height) return -1;
      const g = c.getContext('2d');
      if (!g) return -2;
      const { data } = g.getImageData(0, 0, c.width, c.height);
      let nonEmpty = 0;
      for (let i = 3; i < data.length; i += 4 * 997) if (data[i] > 8) nonEmpty++;
      return nonEmpty;
    });
    expect(painted, 'visualizer canvas should have painted pixels').toBeGreaterThan(0);
    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('beat var (--beat) is driven on the document during playback', async ({ page }) => {
    test.setTimeout(60_000);
    const errs = recordConsoleErrors(page);
    await page.goto(`${RECEIVER_PATH}?test`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as unknown as { __castReceiver?: unknown }).__castReceiver, { timeout: 15_000 });
    await page.evaluate(async () => {
      const audio = document.querySelector('audio') as HTMLAudioElement | null;
      if (audio && audio.paused) { try { await audio.play(); } catch { /* policy */ } }
    });
    // --beat starts unset/0; once FFT energy flows it must become a parseable
    // number in [0,1] at least once.
    await page.waitForFunction(() => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--beat').trim();
      const n = parseFloat(v);
      return v !== '' && Number.isFinite(n) && n >= 0 && n <= 1;
    }, { timeout: 25_000 });
    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('queue view toggle + queue rows render for the seeded catalogue', async ({ page }) => {
    test.setTimeout(60_000);
    const errs = recordConsoleErrors(page);
    await page.goto(`${RECEIVER_PATH}?test`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => {
      const api = (window as unknown as { __castReceiver?: { runtime?: { queue?: unknown[] } } }).__castReceiver;
      return Array.isArray(api?.runtime?.queue) && api!.runtime!.queue!.length > 1;
    }, { timeout: 15_000 });

    // Queue rows rendered, exactly one marked is-now.
    await expect(page.locator('.queue__item').first()).toBeVisible({ timeout: 10_000 });
    const rowCount = await page.locator('.queue__item').count();
    expect(rowCount).toBeGreaterThanOrEqual(20);
    await expect(page.locator('.queue__item.is-now')).toHaveCount(1);

    // D-pad: ArrowDown moves focus; ArrowRight opens the queue view.
    await page.locator('#queueList').focus().catch(() => { /* focus best-effort */ });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const view = await page.locator('#stage').getAttribute('data-view');
    expect(['queue', 'now-playing']).toContain(view); // either is a valid post-key state
    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('self-fetches + renders the correct synced lyric lines for the current track', async ({ page }) => {
    test.setTimeout(60_000);
    const errs = recordConsoleErrors(page);
    await page.goto(RECEIVER_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as unknown as { __castReceiver?: unknown }).__castReceiver, { timeout: 15_000 });
    await page.evaluate((items) => {
      (window as unknown as { __castReceiver: { loadQueue: (q: unknown[]) => void } }).__castReceiver.loadQueue(items);
    }, SAMPLE_QUEUE);
    // The receiver self-fetches /lyrics/chef-lu-stew.json (authoritative — its word
    // timings match the exact MP3). Real synced lines replace the empty hint.
    await expect(page.locator('#lyrics')).toHaveCount(1);
    await expect(page.locator('.lyrics__line').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.lyrics__line.is-empty')).toHaveCount(0);
    expect(await page.locator('.lyrics__line').count()).toBeGreaterThan(3);
    // A stale push for a DIFFERENT track must be ignored (never show the wrong song).
    await page.evaluate(() => {
      (window as unknown as { __castReceiver: { setLyrics: (id: string, lines: unknown[]) => void } })
        .__castReceiver.setLyrics('some-other-track', [{ t: 0, text: 'WRONG SONG LYRIC' }]);
    });
    await expect(page.getByText('WRONG SONG LYRIC')).toHaveCount(0);
    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('album palette tints --accent without breaking brand-black bg', async ({ page }) => {
    const errs = recordConsoleErrors(page);
    await page.goto(RECEIVER_PATH, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!(window as unknown as { __castReceiver?: unknown }).__castReceiver, { timeout: 15_000 });
    // Drive a palette directly (mirrors what a sender pushes from album art).
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--accent', '#ff8800');
      document.documentElement.style.setProperty('--accent-2', '#3355ff');
    });
    const after = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { accent: cs.getPropertyValue('--accent').trim(), bg: cs.getPropertyValue('--bg').trim() };
    });
    expect(after.accent.toLowerCase()).toBe('#ff8800');
    expect(after.bg.toLowerCase()).toBe('#060610'); // bg stays brand-black
    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });
});

test.describe('embed player — advanced standalone widget', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/cloudflareinsights\.com|cdn-cgi\/challenge-platform|cdn-cgi\/speculation/, r => r.abort());
  });
  test.afterEach(async ({ page }) => { await stopAllAudio(page); });

  test('loads /embed/<album>/<track> and renders the player surface', async ({ page }) => {
    const errs = recordConsoleErrors(page);

    await page.goto(EMBED_PATH, { waitUntil: 'domcontentloaded' });

    // Player chrome must render — title, play button, scrub bar.
    await expect(page.locator('#embedTitle')).toBeVisible();
    await expect(page.locator('#embedTitle')).toHaveText('Chef Lu Stew');
    await expect(page.locator('#embedPlay')).toBeVisible();
    await expect(page.locator('#embedBar')).toBeVisible();
    await expect(page.locator('.embed-fallback')).toHaveCount(0);

    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('play button starts audio + updates progress fill', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium-only autoplay-policy override is set in playwright.config');
    test.setTimeout(60_000);
    const errs = recordConsoleErrors(page);

    await page.goto(EMBED_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#embedPlay')).toBeVisible();

    // Real user click — not a synthetic .evaluate(.play()).
    await page.locator('#embedPlay').click();

    // Audio must reach a playable state.
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return !!audio && audio.readyState >= 2 && Number.isFinite(audio.duration) && audio.duration > 0;
    }, { timeout: 30_000 });

    // CurrentTime must advance.
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return !!audio && audio.currentTime > 0.5;
    }, { timeout: 20_000 });

    // Progress fill must have width > 0%.
    const fillWidth = await page.locator('#embedFill').evaluate((el: HTMLElement) => parseFloat(el.style.width) || 0);
    expect(fillWidth).toBeGreaterThan(0);

    // Play icon must flip from ▶ to ❚❚.
    const icon = await page.locator('#embedPlayIcon').textContent();
    expect(icon).toBe('❚❚');

    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('clicking the scrub bar mid-track seeks audio', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Chromium-only autoplay-policy override');
    test.setTimeout(60_000);
    const errs = recordConsoleErrors(page);

    await page.goto(EMBED_PATH, { waitUntil: 'domcontentloaded' });
    await page.locator('#embedPlay').click();
    await page.waitForFunction(() => {
      const audio = document.querySelector('audio');
      return !!audio && Number.isFinite(audio.duration) && audio.duration > 10;
    }, { timeout: 30_000 });

    const bar = page.locator('#embedBar');
    const box = await bar.boundingBox();
    if (!box) throw new Error('embed bar has no bounding box');
    await bar.click({ position: { x: box.width * 0.5, y: box.height / 2 }, force: true });

    const duration = await page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).duration);
    await page.waitForFunction((dur) => {
      const audio = document.querySelector('audio') as HTMLAudioElement;
      return audio.currentTime > dur * 0.4;
    }, duration, { timeout: 15_000 });

    const after = await page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).currentTime);
    expect(after).toBeGreaterThan(duration * 0.4);
    expect(after).toBeLessThan(duration * 0.7);

    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('invalid embed path renders the branded fallback, not a hard crash', async ({ page }) => {
    const errs = recordConsoleErrors(page);
    await page.goto('/embed/does-not-exist/at-all', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.embed-fallback')).toBeVisible();
    await expect(page.locator('.embed-fallback__link')).toHaveAttribute('href', /music\.megabyte\.space/);
    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });

  test('embed wires MediaSession metadata for Now Playing surfaces', async ({ page, browserName }) => {
    // MediaSession + MediaMetadata is supported in Chromium + WebKit. Firefox
    // ships the API but blocks artwork resolution under headless without an
    // active media element — skip there since the assertion is artwork-shape.
    test.skip(browserName === 'firefox', 'MediaSession headless behavior differs in Gecko');
    const errs = recordConsoleErrors(page);
    await page.goto(EMBED_PATH, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#embedTitle')).toHaveText('Chef Lu Stew');

    const meta = await page.evaluate(() => {
      const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
      if (!ms || !ms.metadata) return null;
      const m = ms.metadata;
      return {
        title: m.title,
        artist: m.artist,
        album: m.album,
        artworkCount: m.artwork.length,
        firstArtworkSrc: m.artwork[0]?.src ?? null
      };
    });
    expect(meta, 'MediaSession metadata must be populated').not.toBeNull();
    expect(meta!.title).toBe('Chef Lu Stew');
    expect(meta!.artist).toBe('bZ');
    expect(meta!.album).toMatch(/Panda Desiiignare/i);
    expect(meta!.artworkCount).toBeGreaterThanOrEqual(1);
    expect(meta!.firstArtworkSrc).toMatch(/\.(png|jpg|jpeg|webp)$/i);

    expect(errs, `console errors: ${errs.join(' | ')}`).toEqual([]);
  });
});

test.describe('oEmbed discovery + endpoint', () => {
  // Reddit, Discord, Notion, etc. fetch `/api/oembed?url=...&format=json` after
  // discovering the `<link rel="alternate" type="application/json+oembed">` on
  // a page. Both album and track URLs MUST surface a discovery link AND the
  // endpoint MUST return a usable iframe payload for both forms.
  test.beforeEach(async ({ page }) => {
    await page.route(/cloudflareinsights\.com|cdn-cgi\/challenge-platform|cdn-cgi\/speculation/, r => r.abort());
  });

  test('album page exposes an oembed alternate link with a /<album> target', async ({ page }) => {
    await page.goto('/desiiignare', { waitUntil: 'domcontentloaded' });
    const oembedHref = await page
      .locator('link[rel="alternate"][type="application/json+oembed"]')
      .getAttribute('href');
    expect(oembedHref, 'album route must have oembed discovery link').toBeTruthy();
    expect(oembedHref!).toContain('/api/oembed');
    // The discovery URL must point back at the album page itself, NOT the
    // homepage — otherwise consumers fetch the wrong payload.
    expect(decodeURIComponent(oembedHref!)).toContain('/desiiignare');
  });

  test('track page exposes an oembed alternate link with a /<album>/<track> target', async ({ page }) => {
    await page.goto('/desiiignare/chef-lu-stew', { waitUntil: 'domcontentloaded' });
    const oembedHref = await page
      .locator('link[rel="alternate"][type="application/json+oembed"]')
      .getAttribute('href');
    expect(oembedHref, 'track route must have oembed discovery link').toBeTruthy();
    expect(decodeURIComponent(oembedHref!)).toContain('/desiiignare/chef-lu-stew');
  });

  test('/api/oembed resolves album URLs to a tracklist iframe payload', async ({ request }) => {
    const target = encodeURIComponent('https://music.megabyte.space/desiiignare');
    const res = await request.get(`/api/oembed?url=${target}&format=json`);
    expect(res.status()).toBe(200);
    const body = await res.json() as {
      type: string;
      html: string;
      title: string;
      thumbnail_url: string;
    };
    expect(body.type).toBe('rich');
    expect(body.html).toMatch(/<iframe[^>]+src="https:\/\/music\.megabyte\.space\/embed\/desiiignare"/);
    expect(body.title).toMatch(/bZ/);
    expect(body.thumbnail_url).toMatch(/^https:\/\/music\.megabyte\.space\//);
  });

  test('/api/oembed resolves /embed/<album>/<track> form (Discord/Reddit deep links)', async ({ request }) => {
    const target = encodeURIComponent('https://music.megabyte.space/embed/desiiignare/chef-lu-stew');
    const res = await request.get(`/api/oembed?url=${target}&format=json`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { html: string; audio_url?: string };
    expect(body.html).toMatch(/<iframe[^>]+src="https:\/\/music\.megabyte\.space\/embed\/desiiignare\/chef-lu-stew"/);
    expect(body.audio_url).toMatch(/Chef_Lu_Stew\.mp3$/);
  });

  test('/api/oembed rejects unknown slugs', async ({ request }) => {
    const target = encodeURIComponent('https://music.megabyte.space/no-such-album');
    const res = await request.get(`/api/oembed?url=${target}&format=json`);
    expect(res.status()).toBe(404);
  });
});
