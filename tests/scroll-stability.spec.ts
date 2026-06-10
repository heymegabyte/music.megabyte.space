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

  test('scrolling the album rail then clicking a track preserves scroll position', async ({ page }) => {
    await gotoHome(page);
    // The album list lives inside the scrollable `.rail` (the site-links footer
    // rides the bottom of that scroll, no longer pinned in view).
    const rail = page.locator('.rail');
    await expect(rail).toBeVisible();

    await page.waitForFunction(
      () => {
        const el = document.querySelector('.rail');
        return !!el && (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 200;
      },
      undefined,
      { timeout: 10000 }
    );

    await rail.evaluate(el => {
      (el as HTMLElement).scrollTop = 400;
    });
    const before = await rail.evaluate(el => (el as HTMLElement).scrollTop);
    expect(before).toBeGreaterThan(300);

    const visibleRow = await rail.evaluateHandle(el => {
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
    const after = await rail.evaluate(el => (el as HTMLElement).scrollTop);
    expect(
      Math.abs(after - before),
      `scrollTop drifted ${after - before}px after click (was ${before}, now ${after})`
    ).toBeLessThanOrEqual(8);
  });
});

test.describe('site-links footer sits at the bottom of the album scroll', () => {
  test.beforeEach(async ({ context }) => {
    await context.route(/cloudflareinsights\.com|cdn-cgi\/challenge-platform|cdn-cgi\/speculation/, r =>
      r.abort()
    );
  });

  test('footer is not visible at the top but is reachable by scrolling to the bottom', async ({ page }) => {
    await gotoHome(page);
    const rail = page.locator('.rail');
    const foot = page.locator('.rail__foot');
    await expect(rail).toBeVisible();

    // The rail must actually overflow for "scroll to see the footer" to mean
    // anything — wait for the album list to be taller than the rail viewport.
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.rail');
        return !!el && (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 100;
      },
      undefined,
      { timeout: 10000 }
    );

    // Pin the rail to the top, then assert the footer is below the fold.
    await rail.evaluate(el => {
      (el as HTMLElement).scrollTop = 0;
    });
    const footBelowFoldAtTop = await rail.evaluate(el => {
      const host = el as HTMLElement;
      const f = host.querySelector('.rail__foot') as HTMLElement | null;
      if (!f) return false;
      return f.getBoundingClientRect().top > host.getBoundingClientRect().bottom - 4;
    });
    expect(
      footBelowFoldAtTop,
      'footer should be below the visible fold when the rail is scrolled to the top'
    ).toBe(true);

    // Scroll the rail to the bottom — the footer comes into view.
    await rail.evaluate(el => {
      (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
    });
    await page.waitForTimeout(150);
    await expect(foot).toBeInViewport();
    await expect(page.locator('.rail__foot-copy')).toContainText('Megabyte Labs');
  });
});
