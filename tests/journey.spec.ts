import { test, expect } from '@playwright/test';

const FIRST_TRACK = 'birch-swing-heaven';

test.describe.configure({ mode: 'parallel' });

const gotoHome = async (page: import('@playwright/test').Page, qs = '') => {
  await page.goto(`/${qs}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('#heroTitle', { state: 'visible', timeout: 15000 });
};

test.describe('music.megabyte.space — golden journey', () => {
  test.beforeEach(async ({ context }) => {
    await context.route(/cloudflareinsights\.com|cdn-cgi\/challenge-platform|cdn-cgi\/speculation/, r => r.abort());
  });
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      document.querySelectorAll('audio').forEach(a => {
        try { a.pause(); a.removeAttribute('src'); a.load(); } catch {}
      });
    }).catch(() => {});
  });

  test('home loads, no console errors, hero renders', async ({ page }) => {
    const errs: string[] = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error' && !/sw register failed|favicon|Failed to load resource|net::ERR_|speculation rules/i.test(m.text())) {
        errs.push(m.text());
      }
    });
    await gotoHome(page);
    await expect(page.locator('#heroTitle')).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('share-chip-row never overlaps trackrow stats', async ({ page, isMobile }) => {
    await gotoHome(page);
    const wrap = page.locator('.trackrow-wrap').first();
    await wrap.scrollIntoViewIfNeeded();
    if (!isMobile) await wrap.hover();
    const stats = wrap.locator('.trackrow__stats');
    const chip = wrap.locator('.share-chip--row');
    await expect(stats).toBeVisible();
    await expect(chip).toBeVisible();
    const sb = await stats.boundingBox();
    const cb = await chip.boundingBox();
    if (!sb || !cb) throw new Error('no boxes');
    const overlap = sb.x + sb.width > cb.x && cb.x + cb.width > sb.x;
    expect(overlap, `stats(${sb.x}+${sb.width})=${sb.x + sb.width} vs chip(${cb.x})=${cb.x}`).toBe(false);
  });

  test('install banner Later button persists dismissal', async ({ page, context }) => {
    await context.clearCookies();
    await gotoHome(page);
    await page.evaluate(() => localStorage.clear());
    await page.goto('/?install=1', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#heroTitle');
    const banner = page.locator('#installBanner');
    await expect(banner).toBeVisible({ timeout: 10000 });
    await page.locator('#installDismiss').click();
    await expect(banner).toBeHidden();
    const snooze = await page.evaluate(() => localStorage.getItem('bz:installSnoozeUntil'));
    expect(snooze).toBeTruthy();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#heroTitle');
    await expect(page.locator('#installBanner')).toBeHidden();
  });

  test('seek bar click jumps audio to mid-track', async ({ page, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium', 'Chromium-only autoplay tweak');
    test.setTimeout(90000);
    await page.goto(`/canopy/${FIRST_TRACK}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => {
      const a = document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement | null;
      return !!a && Number.isFinite(a.duration) && a.duration > 0;
    }, { timeout: 30000 });
    await page.evaluate(async () => {
      const dialog = document.querySelector('#autoplayPrompt') as HTMLDialogElement | null;
      if (dialog?.open) dialog.close();
      document.documentElement.classList.remove('is-autoplay-prompt');
      const a = document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement;
      try { await a.play(); } catch {}
    });
    await page.waitForFunction(() => {
      const a = document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement | null;
      return !!a && !a.paused && a.readyState >= 2;
    }, { timeout: 15000 });
    const dur = await page.evaluate(() => (document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement).duration);
    expect(dur).toBeGreaterThan(10);

    const bar = page.locator('#bar').first();
    await bar.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const b = document.querySelector('#bar') as HTMLElement | null;
      return !!b && b.getBoundingClientRect().width > 50;
    }, { timeout: 10000 });
    const fireScrub = async (ratio: number) => {
      const box = await bar.boundingBox();
      if (!box) throw new Error('no bar');
      await bar.click({ position: { x: box.width * ratio, y: box.height / 2 }, force: true });
    };
    await fireScrub(0.5);
    await page.waitForFunction(() => {
      const a = document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement;
      return a && a.currentTime > 5;
    }, { timeout: 30000 });
    const after = await page.evaluate(() => {
      const a = document.querySelector('audio[data-engine="bz"]') as HTMLAudioElement;
      return { currentTime: a.currentTime, duration: a.duration, paused: a.paused, readyState: a.readyState };
    });
    expect(after.currentTime, `seek state ${JSON.stringify(after)}`).toBeGreaterThan(dur * 0.4);
    expect(after.currentTime).toBeLessThan(dur * 0.6);

    if (!isMobile) {
      await fireScrub(0.85);
      const after2 = await page.evaluate(() => (document.querySelector('audio') as HTMLAudioElement).currentTime);
      expect(after2).toBeGreaterThan(dur * 0.78);
    }
  });

  test('per-route meta unique on track page', async ({ request }) => {
    const r = await request.get(`/canopy/${FIRST_TRACK}`);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html).toMatch(/<title>Touch The Sky[^<]+<\/title>/);
    expect(html).toContain(`og/track-${FIRST_TRACK}.jpg`);
    const titleLen = html.match(/<title>([^<]+)<\/title>/)?.[1].length ?? 0;
    expect(titleLen).toBeGreaterThanOrEqual(50);
    expect(titleLen).toBeLessThanOrEqual(60);
    expect(html).toMatch(/class="route-seo-prose"/);
  });

  test('share dialog opens from track row chip', async ({ page, isMobile }) => {
    await gotoHome(page);
    const wrap = page.locator('.trackrow-wrap').first();
    await wrap.scrollIntoViewIfNeeded();
    if (!isMobile) await wrap.hover();
    await page.locator('.share-chip--row').first().click();
    await expect(page.locator('#share')).toBeVisible();
    const link = await page.locator('#shareLink').inputValue();
    expect(link).toMatch(/^https:\/\/music\.megabyte\.space\//);
    await page.locator('#shareClose').click();
    await expect(page.locator('#share')).toBeHidden();
  });

  test('notify modal collects email and posts to /api/subscribe', async ({ page, context }) => {
    let captured: { email?: string; source?: string } | null = null;
    await context.route('**/api/subscribe', async route => {
      const req = route.request();
      try { captured = JSON.parse(req.postData() || '{}'); } catch { captured = {}; }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, listmonk: 'subscribed', push: 'skipped' })
      });
    });
    await gotoHome(page);
    await page.evaluate(() => localStorage.removeItem('bz:notify:email'));
    const nudge = page.locator('.album__subscribe').first();
    await nudge.scrollIntoViewIfNeeded();
    await expect(nudge).toBeVisible();
    await nudge.click();
    const dlg = page.locator('#notifyDialog');
    await expect(dlg).toBeVisible();
    const email = `playwright+${Date.now()}@megabyte.space`;
    await page.locator('#notifyEmail').fill(email);
    await page.locator('#notifySubmit').click();
    await expect(dlg).toBeHidden();
    expect(captured?.email).toBe(email);
    const stored = await page.evaluate(() => localStorage.getItem('bz:notify:email'));
    expect(stored).toBe(email);
    await expect(page.locator('.album__subscribe').first()).toBeHidden();
  });

  test('notify modal rejects empty email with inline error', async ({ page }) => {
    await gotoHome(page);
    await page.evaluate(() => localStorage.removeItem('bz:notify:email'));
    await page.locator('.album__subscribe').first().scrollIntoViewIfNeeded();
    await page.locator('.album__subscribe').first().click();
    await expect(page.locator('#notifyDialog')).toBeVisible();
    await page.locator('#notifyEmail').fill('not-an-email');
    await page.locator('#notifySubmit').click();
    await expect(page.locator('#notifyError')).toBeVisible();
    await expect(page.locator('#notifyError')).toContainText(/valid email/i);
    await expect(page.locator('#notifyDialog')).toBeVisible();
  });
});
