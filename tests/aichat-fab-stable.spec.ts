import { test, expect } from '@playwright/test';

const gotoHome = async (page: import('@playwright/test').Page) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('#heroTitle', { state: 'visible', timeout: 15000 });
};

test.describe('regression — .aichat__fab is stable enough for instant click', () => {
  test.beforeEach(async ({ context }) => {
    await context.route(/cloudflareinsights\.com|cdn-cgi\/challenge-platform|cdn-cgi\/speculation/, r =>
      r.abort()
    );
  });

  test('FAB bounding box does not change while breathing animation runs', async ({ page }) => {
    await gotoHome(page);
    const fab = page.locator('[data-aichat="fab"]').first();
    await expect(fab).toBeVisible();

    const box1 = await fab.boundingBox();
    if (!box1) throw new Error('no fab box');
    await page.waitForTimeout(1100);
    const box2 = await fab.boundingBox();
    if (!box2) throw new Error('no fab box after wait');

    const dx = Math.abs(box2.x - box1.x);
    const dy = Math.abs(box2.y - box1.y);
    const dw = Math.abs(box2.width - box1.width);
    const dh = Math.abs(box2.height - box1.height);
    const drift = Math.max(dx, dy, dw, dh);
    expect(
      drift,
      `fab drifted ${drift.toFixed(2)}px in 1.1s (box1=${JSON.stringify(box1)} box2=${JSON.stringify(box2)})`
    ).toBeLessThanOrEqual(1);
  });

  test('clicking the FAB opens the chat panel within the default action timeout', async ({ page }) => {
    await gotoHome(page);
    const fab = page.locator('[data-aichat="fab"]').first();
    await expect(fab).toBeVisible();
    await fab.click();
    const panel = page.locator('[data-aichat="panel"]').first();
    await expect(panel).toBeVisible();
    const input = page.locator('[data-aichat="input"]').first();
    await expect(input).toBeFocused();
  });
});
