import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

const gotoHome = async (page: Page) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('#heroTitle', { state: 'visible', timeout: 15000 });
};

const openChat = async (page: Page) => {
  const fab = page.locator('[data-aichat="fab"]').first();
  await expect(fab).toBeVisible();
  await fab.click({ force: true });
  const panel = page.locator('[data-aichat="panel"]').first();
  await expect(panel).toBeVisible();
  return panel;
};

const sendSlash = async (page: Page, cmd: string) => {
  const input = page.locator('[data-aichat="input"]').first();
  await input.fill(cmd);
  await input.press('Enter');
};

test.describe('AI chat — widget renderer', () => {
  test.beforeEach(async ({ context }) => {
    await context.route(
      /cloudflareinsights\.com|cdn-cgi\/challenge-platform|cdn-cgi\/speculation/,
      r => r.abort()
    );
  });

  test('Cmd+I opens the chat panel from any focus', async ({ page }) => {
    await gotoHome(page);
    await page.locator('body').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+i' : 'Control+i');
    await expect(page.locator('[data-aichat="panel"]').first()).toBeVisible();
  });

  test('/shortcommands palette is keyboard-actionable', async ({ page }) => {
    await gotoHome(page);
    await openChat(page);
    await sendSlash(page, '/shortcommands');
    const palette = page.locator('.aichat__widget--palette').first();
    await expect(palette).toBeVisible({ timeout: 8000 });
    await expect(palette).toHaveAttribute('aria-label', /command palette/i);
    const buttons = palette.locator('[data-aichat-cmd]');
    expect(await buttons.count()).toBeGreaterThan(5);
  });

  test('/stats emits chart + comparison-table widgets or graceful empty state', async ({ page }) => {
    await gotoHome(page);
    await openChat(page);
    await sendSlash(page, '/stats');
    const lastAi = page.locator('.aichat__msg.aichat__msg--ai').last();
    await expect(lastAi).toBeVisible({ timeout: 6000 });
    const chart = lastAi.locator('.aichat__widget--chart');
    const cmp = lastAi.locator('.aichat__widget--cmp');
    const emptyText = await lastAi.textContent();
    const hasChart = (await chart.count()) > 0;
    const hasCmp = (await cmp.count()) > 0;
    const isWarming = /warming up|could not load|stats fetch failed/i.test(emptyText || '');
    expect(hasChart || hasCmp || isWarming).toBe(true);
    if (hasChart) {
      await expect(chart).toHaveAttribute('aria-label', /.+/);
    }
  });

  test('Escape closes the panel and Cmd+I reopens it', async ({ page }) => {
    await gotoHome(page);
    const panel = await openChat(page);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+i' : 'Control+i');
    await expect(panel).toBeVisible();
  });

  test('palette widget links use safe hrefs only', async ({ page }) => {
    await gotoHome(page);
    await openChat(page);
    await sendSlash(page, '/shortcommands');
    const palette = page.locator('.aichat__widget--palette').first();
    await expect(palette).toBeVisible({ timeout: 8000 });
    const html = await palette.innerHTML();
    expect(html).not.toMatch(/href=["']javascript:/i);
    expect(html).not.toMatch(/href=["']data:/i);
    expect(html).not.toContain('<script');
  });
});
