import { test, expect } from '@playwright/test';

// Only run when emulating a mobile viewport. The desktop projects share this
// file (Playwright doesn't filter by project at test-collect time) but the
// assertions only hold under the mobile media-query split.
test.describe('mobile — viz top half, playlist bottom half', () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 760, 'mobile-only layout');

  test.beforeEach(async ({ context }) => {
    await context.route(/cloudflareinsights\.com|cdn-cgi\/challenge-platform|cdn-cgi\/speculation/, r =>
      r.abort()
    );
  });

  test('viz canvas occupies top half, albums list occupies bottom half', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('#heroTitle', { state: 'visible', timeout: 15000 });

    const layout = await page.evaluate(() => {
      const bg = document.querySelector('#bg') as HTMLCanvasElement | null;
      const rail = document.querySelector('.rail') as HTMLElement | null;
      const viz = document.querySelector('.viz') as HTMLElement | null;
      const transport = document.querySelector('.transport') as HTMLElement | null;
      if (!bg || !rail || !viz) return null;
      const b = bg.getBoundingClientRect();
      const r = rail.getBoundingClientRect();
      const v = viz.getBoundingClientRect();
      const t = transport?.getBoundingClientRect() ?? null;
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        bg: { top: b.top, bottom: b.bottom, height: b.height },
        rail: { top: r.top, bottom: r.bottom, height: r.height },
        viz: { top: v.top, bottom: v.bottom, height: v.height },
        transport: t ? { top: t.top, height: t.height } : null
      };
    });
    if (!layout) throw new Error('no layout');

    // BG canvas should NOT span the whole viewport on mobile.
    expect(layout.bg.height, `bg ${layout.bg.height} vs viewport ${layout.viewport.h}`).toBeLessThan(
      layout.viewport.h * 0.7
    );

    // Rail (playlist) should sit BELOW the viz column on mobile.
    expect(
      layout.rail.top,
      `rail top ${layout.rail.top} vs viz bottom ${layout.viz.bottom}`
    ).toBeGreaterThanOrEqual(layout.viz.bottom - 4);

    // Visualizer half should be roughly equal to playlist half (within 30% tolerance).
    const ratio = layout.viz.height / Math.max(1, layout.rail.height);
    expect(
      ratio,
      `viz/rail ratio ${ratio.toFixed(2)} (viz=${layout.viz.height}, rail=${layout.rail.height})`
    ).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(1.6);

    // Playlist must reach near the transport bar (no large gap).
    if (layout.transport) {
      const gap = layout.transport.top - layout.rail.bottom;
      expect(Math.abs(gap), `gap between rail and transport: ${gap}`).toBeLessThanOrEqual(2);
    }
  });

  test('scrolling the album list works without scrolling the page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('#heroTitle', { state: 'visible', timeout: 15000 });
    // The `.rail` is the internal scroll container (the album list flows
    // full-length inside it, with the site-links footer at the bottom).
    const rail = page.locator('.rail');
    await expect(rail).toBeVisible();

    const docScrollBefore = await page.evaluate(() => document.documentElement.scrollTop);
    await rail.evaluate(el => {
      (el as HTMLElement).scrollTop = 300;
    });
    await page.waitForTimeout(120);
    const railScroll = await rail.evaluate(el => (el as HTMLElement).scrollTop);
    const docScrollAfter = await page.evaluate(() => document.documentElement.scrollTop);
    expect(railScroll, 'rail scrolled internally').toBeGreaterThan(0);
    expect(docScrollAfter, 'document did not scroll').toBe(docScrollBefore);
  });
});
