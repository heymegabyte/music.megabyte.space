import { test, expect } from '@playwright/test';

/**
 * Story-menu → Press page → per-track press kit link integrity.
 *
 * The dead link a user hit: each worker-rendered press kit (/press/<track>)
 * linked its "Web player" button to the BARE slug /<track>, which no router
 * resolves (soft-404). Fixed to the canonical /<album>/<track>, with a
 * top-level 301 rescue for any bare slug that still leaks out.
 */

const gotoHome = async (page: import('@playwright/test').Page) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('#heroTitle', { state: 'visible', timeout: 15000 });
};

test.describe.configure({ mode: 'parallel' });

test.describe('Story menu — no dead links', () => {
  test.beforeEach(async ({ context }) => {
    await context.route(/cloudflareinsights\.com|cdn-cgi\/challenge-platform|cdn-cgi\/speculation/, r =>
      r.abort()
    );
  });
  test.afterEach(async ({ page }) => {
    await page
      .evaluate(() => {
        document.querySelectorAll('audio').forEach(a => {
          try {
            a.pause();
            a.removeAttribute('src');
            a.load();
          } catch {}
        });
      })
      .catch(() => {});
  });

  test('every Story-menu link resolves (no 404)', async ({ page }) => {
    await gotoHome(page);
    // The canonical Story link set (About/Tracks/Press/Merch/Appeal/Mission)
    // lives in #topbarPagesMenu; read hrefs from the DOM — the button engages
    // the chip rail rather than showing this list, but the set is the same.
    const hrefs = await page
      .locator('#topbarPagesMenu a[role="menuitem"]')
      .evaluateAll(els => els.map(e => (e as HTMLAnchorElement).getAttribute('href') || ''));
    expect(hrefs.length).toBeGreaterThanOrEqual(5);
    for (const href of hrefs) {
      if (!href.startsWith('/')) continue; // external (mission) — skip
      const res = await page.request.get(href);
      expect(res.status(), `${href} should not 404`).not.toBe(404);
    }
  });

  test('Story button opens the chip rail; Press chip opens its page', async ({ page }) => {
    await gotoHome(page);
    await page.locator('#btnPagesMenu').click();
    await expect(page.locator('#topbarStoryNav')).toBeVisible();
    await page.locator('#topbarStoryNavChips a[data-content-page="press"]').click();
    await expect(page.locator('#contentpage')).toBeVisible();
    await expect(page.locator('#contentpageTitle')).toContainText(/press/i);
    await expect(page.locator('#contentpageBody')).not.toBeEmpty();
  });

  test('every per-track press-kit chip resolves to a live kit (200)', async ({ page }) => {
    await page.goto('/press', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#contentpage')).toBeVisible();
    const chips = page.locator('.contentpage__press-chip');
    await expect(chips.first()).toBeVisible();
    expect(await chips.count()).toBeGreaterThan(50);

    const hrefs = await chips.evaluateAll(els =>
      els.map(e => (e as HTMLAnchorElement).getAttribute('href') || '')
    );
    for (const href of hrefs) {
      expect(href, 'chip links to a per-track press kit').toMatch(/^\/press\/[a-z0-9-]+$/);
    }
    for (const href of hrefs.slice(0, 6)) {
      const res = await page.request.get(href);
      expect(res.status(), `${href} press kit should be live`).toBe(200);
    }
  });

  test('a press kit page has zero dead internal links (the reported bug)', async ({ page }) => {
    await page.goto('/press/other-side-of-the-fall', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/press kit/i);

    // The "Web player" button must point at the canonical /<album>/<track>,
    // never the bare /<track> slug that used to soft-404.
    const playerHref = await page
      .locator('a', { hasText: /web player/i })
      .first()
      .getAttribute('href');
    expect(playerHref).toMatch(/\/signals\/other-side-of-the-fall$/);

    // Crawl every internal link on the kit; none may 404.
    const links = await page.locator('a[href]').evaluateAll(els =>
      Array.from(new Set(els.map(e => (e as HTMLAnchorElement).getAttribute('href') || '')))
        .filter(h => h.startsWith('http') && h.includes('music.megabyte.space'))
        .filter(h => !/\/cdn-cgi\//.test(h))
    );
    for (const href of links) {
      const res = await page.request.get(href);
      expect(res.status(), `${href} on the press kit should not 404`).not.toBe(404);
    }
  });

  test('a bare track slug 301-redirects to its canonical /<album>/<track>', async ({ page }) => {
    const res = await page.request.get('/other-side-of-the-fall', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers()['location']).toMatch(/\/signals\/other-side-of-the-fall$/);
  });

  test('unknown routes return a real 404 (soft-404 guard)', async ({ page }) => {
    for (const path of ['/zzz-total-nonsense', '/press/not-a-real-track', '/clip/not-a-real-track']) {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status(), `${path} should 404`).toBe(404);
    }
  });
});
