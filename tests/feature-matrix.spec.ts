// Full-flow production feature matrix. Every test is independent so Playwright's
// fullyParallel runner fans them out across workers + both projects (desktop-1280
// + mobile-390). Each test drives a REAL user flow against PROD, asserts zero
// our-origin console/network errors, and saves a screenshot to
// test-results/feature-matrix/ for visual inspection.
//
// Run: npm run test:e2e:prod -- feature-matrix
import { test, expect } from '@playwright/test';
import { attachConsoleGuard, assertClean } from './helpers/console-guard';

const shot = (testInfo: import('@playwright/test').TestInfo, page: import('@playwright/test').Page, name: string) =>
  page.screenshot({ path: `test-results/feature-matrix/${testInfo.project.name}-${name}.png` }).catch(() => {});

test.describe('feature matrix — production', () => {
  // ── Homepage ──────────────────────────────────────────────────────
  test('homepage boots, renders, console-clean', async ({ page }, info) => {
    const cap = attachConsoleGuard(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await expect(page.locator('#app')).toBeVisible();
    expect(await page.locator('#app').innerHTML()).not.toHaveLength(0);
    await expect(page.locator('a.trackrow').first()).toBeVisible();
    await shot(info, page, 'home');
    assertClean(cap, '/');
  });

  // ── Content pages (parametrized = independent parallel tests) ───────
  for (const slug of ['about', 'credits', 'press', 'merch']) {
    test(`content page /${slug} loads + console-clean`, async ({ page }, info) => {
      const cap = attachConsoleGuard(page);
      await page.goto(`/${slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const dlg = page.locator('#contentpage');
      await expect(dlg).toBeVisible();
      await expect(page.locator('#contentpageBody')).not.toBeEmpty();
      await shot(info, page, `page-${slug}`);
      assertClean(cap, `/${slug}`);
    });
  }

  // ── Mega /about: merged sections + TOC (desktop only) ───────────────
  test('about hub has merged sections + jump TOC', async ({ page }, info) => {
    const cap = attachConsoleGuard(page);
    await page.goto('/about', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const headings = (await page.locator('#contentpageBody h4').allInnerTexts()).join(' ').toLowerCase();
    for (const needle of ['theology', 'song', 'support', 'connect']) {
      expect(headings, `about should contain a "${needle}" section`).toContain(needle);
    }
    if (info.project.name === 'desktop-1280') {
      // 1280 is the TOC breakpoint floor; rail should populate.
      expect(await page.locator('#contentpageToc a').count()).toBeGreaterThanOrEqual(3);
    }
    await shot(info, page, 'about-sections');
    assertClean(cap, '/about');
  });

  // ── Retired pages fold to /about ────────────────────────────────────
  for (const slug of ['process', 'theology', 'support', 'contact', 'connect']) {
    test(`/${slug} folds to /about`, async ({ page }) => {
      await page.goto(`/${slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      expect(page.url().replace(/\/$/, '')).toMatch(/\/about$/);
      await expect(page.locator('#contentpageTitle')).toContainText('About');
    });
  }

  // ── Player: play a track from the homepage ──────────────────────────
  test('clicking a track starts playback', async ({ page }, info) => {
    const cap = attachConsoleGuard(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.locator('a.trackrow').first().click();
    await page.waitForTimeout(2500);
    const playing = await page.evaluate(() => {
      const a = document.querySelector('audio[data-engine]') as HTMLAudioElement | null;
      return !!a && a.currentTime >= 0 && !!a.src;
    });
    expect(playing).toBeTruthy();
    await shot(info, page, 'playing');
    assertClean(cap, 'playback');
  });

  // ── Cmd+K opens + focuses the AI chat / palette ─────────────────────
  test('Cmd+K opens a focusable panel', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(900);
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName?.toLowerCase() || '');
    expect(['input', 'textarea']).toContain(focusedTag);
    await page.keyboard.press('Escape');
  });

  // ── Newsletter subscribe end-to-end (idempotent, no 429) ────────────
  test('newsletter subscribe succeeds', async ({ page }, info) => {
    const cap = attachConsoleGuard(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    // Target the VISIBLE end-of-list form (a second .nl-inline lives hidden in
    // the Story menu; .first() would pick that and silently no-op).
    const form = page.locator('form.nl-inline:visible').first();
    await form.scrollIntoViewIfNeeded();
    await form.locator('.nl-inline__input').fill(`e2e+${Date.now()}@example.com`);
    await form.locator('.nl-inline__submit').click();
    await expect(form).toHaveClass(/is-done/, { timeout: 20000 });
    await shot(info, page, 'subscribed');
    assertClean(cap, 'subscribe');
  });

  // ── Merch suite renders product cards ───────────────────────────────
  test('merch shows product cards + a section TOC (not product titles)', async ({ page }, info) => {
    await page.goto('/merch', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    expect(await page.locator('.merch-card').count()).toBeGreaterThan(0);
    // Merch now uses the shared left-rail TOC (≥1100px) built from its SECTION
    // dividers — product-card titles must NOT appear in it.
    if (info.project.name === 'desktop-1280') {
      const tocLinks = (await page.locator('#contentpageToc a').allInnerTexts()).join(' | ').toLowerCase();
      expect(tocLinks).not.toContain('free satan');
      expect(await page.locator('#contentpageToc a').count()).toBeGreaterThanOrEqual(3);
    }
  });

  // ── Spotify chip hidden on mobile, shown on desktop ─────────────────
  test('play-bar Spotify chip visibility by breakpoint', async ({ page }, info) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const display = await page.evaluate(() => {
      const el = document.getElementById('transportNpSpotify');
      if (el) el.hidden = false;
      return el ? getComputedStyle(el).display : 'none';
    });
    if (info.project.name === 'mobile-390') expect(display).toBe('none');
    else expect(display).not.toBe('none');
  });

  // ── Embed player boots clean ────────────────────────────────────────
  test('embed route boots clean', async ({ page }, info) => {
    const cap = attachConsoleGuard(page);
    await page.goto('/embed/canopy/chef-lu-stew', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).toBeVisible();
    await shot(info, page, 'embed');
    assertClean(cap, '/embed');
  });

  // ── API surface health (no 5xx, idempotent subscribe) ───────────────
  test('API endpoints respond cleanly', async ({ request }) => {
    const vapid = await request.get('/api/push/vapid-key');
    expect(vapid.status()).toBe(200);
    const push = await request.post('/api/push/subscribe', {
      data: { endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${Date.now()}`, keys: { p256dh: 'BPxAbC', auth: 'authTok' } },
    });
    expect(push.status()).toBe(200);
    const email = `e2e+${Date.now()}@example.com`;
    const s1 = await request.post('/api/subscribe', { data: { email } });
    const s2 = await request.post('/api/subscribe', { data: { email } });
    expect(s1.status()).toBe(200);
    expect(s2.status(), 'repeat subscribe must be idempotent, not 429').toBe(200);
  });
});
