import { test, expect } from '@playwright/test';

const gotoHome = async (page: import('@playwright/test').Page) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('#heroTitle', { state: 'visible', timeout: 15000 });
};

test.describe('regression — clicking a track row does not jump the list', () => {
  test.beforeEach(async ({ context }) => {
    await context.route(/cloudflareinsights\.com|cdn-cgi\/challenge-platform|cdn-cgi\/speculation/, r =>
      r.abort()
    );
  });

  test('scrolling the album list then clicking a track preserves scroll position', async ({ page }) => {
    await gotoHome(page);
    const albums = page.locator('#albums');
    await expect(albums).toBeVisible();

    await page.waitForFunction(
      () => {
        const el = document.querySelector('#albums');
        return !!el && (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 200;
      },
      undefined,
      { timeout: 10000 }
    );

    await albums.evaluate(el => {
      (el as HTMLElement).scrollTop = 400;
    });
    const before = await albums.evaluate(el => (el as HTMLElement).scrollTop);
    expect(before).toBeGreaterThan(300);

    const visibleRow = await albums.evaluateHandle(el => {
      const host = el as HTMLElement;
      const hostRect = host.getBoundingClientRect();
      const rows = Array.from(host.querySelectorAll<HTMLAnchorElement>('.trackrow:not(.is-current)'));
      return (
        rows.find(r => {
          const rect = r.getBoundingClientRect();
          return rect.top >= hostRect.top + 20 && rect.bottom <= hostRect.bottom - 20;
        }) ?? null
      );
    });
    const rowEl = visibleRow.asElement();
    if (!rowEl) throw new Error('no visible non-current row to click');
    await rowEl.scrollIntoViewIfNeeded();
    await rowEl.click({ force: true });

    await page.waitForTimeout(900);
    const after = await albums.evaluate(el => (el as HTMLElement).scrollTop);
    expect(
      Math.abs(after - before),
      `scrollTop drifted ${after - before}px after click (was ${before}, now ${after})`
    ).toBeLessThanOrEqual(8);
  });
});
