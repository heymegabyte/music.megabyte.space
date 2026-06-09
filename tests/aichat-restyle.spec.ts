import { test, expect } from '@playwright/test';

const gotoHome = async (page: import('@playwright/test').Page) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('#heroTitle', { state: 'visible', timeout: 15000 });
};

test.describe('AI chat — restyle invariants', () => {
  test.beforeEach(async ({ context }) => {
    await context.route(/cloudflareinsights\.com|cdn-cgi\/challenge-platform|cdn-cgi\/speculation/, r =>
      r.abort()
    );
  });

  test('daily ritual element does not exist in the DOM', async ({ page }) => {
    await gotoHome(page);
    await page.locator('[data-aichat="fab"]').first().click();
    await expect(page.locator('[data-aichat="panel"]').first()).toBeVisible();
    const ritual = page.locator('[data-aichat="ritual"]');
    await expect(ritual).toHaveCount(0);
    const ritualClass = page.locator('.aichat__ritual');
    await expect(ritualClass).toHaveCount(0);
  });

  test('compose stack wraps composer + banners as one card', async ({ page }) => {
    await gotoHome(page);
    await page.locator('[data-aichat="fab"]').first().click();
    const stack = page.locator('[data-aichat="composeStack"]');
    await expect(stack).toBeVisible();
    // Composer + continueBanner + urlhint + snipbar must all be inside the
    // stack (no longer scattered bottom-pinned strips). The quickbar was
    // removed entirely — slash commands live in the composer only.
    await expect(stack.locator('[data-aichat="composer"]')).toBeVisible();
    await expect(stack.locator('[data-aichat="continueBanner"]')).toHaveCount(1);
    await expect(stack.locator('[data-aichat="snipbar"]')).toHaveCount(1);
    // Quickbar element must NOT exist anywhere in the panel.
    await expect(page.locator('[data-aichat="quickbar"]')).toHaveCount(0);
    await expect(page.locator('.aichat__quickbar')).toHaveCount(0);
  });

  test('persona pill is visible in the header and reveals a popover on click', async ({ page }) => {
    await gotoHome(page);
    await page.locator('[data-aichat="fab"]').first().click();
    const pill = page.locator('[data-aichat="personaPill"]');
    await expect(pill).toBeVisible();
    await expect(pill.locator('[data-aichat="personaLabel"]')).not.toBeEmpty();
    await pill.click();
    const menu = page.locator('[data-aichat="personaMenu"]');
    await expect(menu).toBeVisible();
    // Should list at least the DJ persona as a switchable option.
    await expect(menu.locator('[data-persona-pick]').first()).toBeVisible();
  });

  test('compose stack sits well above the panel bottom edge (no edge-pinning)', async ({ page }) => {
    await gotoHome(page);
    await page.locator('[data-aichat="fab"]').first().click();
    const layout = await page.evaluate(() => {
      const panel = document.querySelector('[data-aichat="panel"]') as HTMLElement | null;
      const stack = document.querySelector('[data-aichat="composeStack"]') as HTMLElement | null;
      if (!panel || !stack) return null;
      const p = panel.getBoundingClientRect();
      const s = stack.getBoundingClientRect();
      return { panelBottom: p.bottom, stackBottom: s.bottom, gap: p.bottom - s.bottom };
    });
    if (!layout) throw new Error('no layout');
    // Stack must clear the panel's bottom edge by at least 10px so it reads
    // as a lifted card, not bound to the chrome.
    expect(layout.gap, `compose-stack bottom gap: ${layout.gap}px`).toBeGreaterThanOrEqual(10);
  });
});
