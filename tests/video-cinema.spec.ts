import { test, expect, type Page } from '@playwright/test';

// Cinematic film player — the fullscreen music-video overlay wired to tracks
// that carry a `video` field (Bermuda Prophecy is the first). Runs against
// PROD_URL like the rest of the suite.
const BASE = process.env.PROD_URL || 'https://music.megabyte.space';

// Mobile blocks autoplay -> the "tap to play" prompt (#apClose) can intercept
// clicks. Dismiss it before driving the transport. No-op on desktop.
async function dismissAutoplayPrompt(page: Page) {
  const close = page.locator('#apClose');
  if (await close.isVisible().catch(() => false)) await close.click();
}

test.describe('Cinematic film player', () => {
  test('Bermuda Prophecy shows a Watch button that opens + closes the film', async ({ page }) => {
    await page.goto(`${BASE}/signals/bermuda-prophecy`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#transportNpTitle')).toHaveText('Bermuda Prophecy', { timeout: 15000 });
    await dismissAutoplayPrompt(page);

    // Open the now-playing panel via the transport cover. The cover pulses with
    // the beat (never "stable"), so trigger the handler directly like the sibling
    // play-order spec does for animated controls.
    await page.locator('#transportNpCover').evaluate((el: HTMLElement) => el.click());
    const watch = page.locator('#npPanelWatch');
    await expect(watch).toBeVisible({ timeout: 10000 });

    // Open the film — overlay appears with the right source.
    await watch.evaluate((el: HTMLElement) => el.click());
    const cinema = page.locator('#videoCinema');
    await expect(cinema).toBeVisible({ timeout: 10000 });
    const src = await page
      .locator('#videoCinemaPlayer')
      .evaluate((el: HTMLVideoElement) => el.currentSrc || el.src);
    expect(src).toContain('bermuda-prophecy.mp4');

    // Escape closes it.
    await page.keyboard.press('Escape');
    await expect(cinema).toBeHidden({ timeout: 10000 });
  });

  test('a track without a film hides the Watch button', async ({ page }) => {
    await page.goto(`${BASE}/reckless-grace/reckless-grace`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#transportNpTitle')).toHaveText('Reckless Grace', { timeout: 15000 });
    await dismissAutoplayPrompt(page);
    await page.locator('#transportNpCover').evaluate((el: HTMLElement) => el.click());
    await expect(page.locator('#npPanelWatch')).toBeHidden();
  });
});
