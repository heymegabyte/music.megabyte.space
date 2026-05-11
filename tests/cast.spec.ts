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
});
