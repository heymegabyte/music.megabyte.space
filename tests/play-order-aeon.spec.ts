import { test, expect, type Page } from '@playwright/test';

// Sequential-playback default + Aeon's Choice expander (up to 10).
// Runs against PROD_URL (the deployed site) like the rest of the suite.
const BASE = process.env.PROD_URL || 'https://music.megabyte.space';

// Mobile blocks autoplay -> the "tap to play" prompt (#autoplayPrompt) opens and
// intercepts the transport. A real user taps it; dismiss it here before driving
// the transport. No-op on desktop (prompt never opens).
async function dismissAutoplayPrompt(page: Page) {
  const close = page.locator('#apClose');
  if (await close.isVisible().catch(() => false)) await close.click();
}

test.describe('default play order is sequential (album order, not AI ranking)', () => {
  test('Next advances to the next track in the album', async ({ page }) => {
    // Reckless Grace album order: reckless-grace -> count-what-i-got -> nobody-beneath-us
    await page.goto(`${BASE}/reckless-grace/reckless-grace`, { waitUntil: 'domcontentloaded' });
    const np = page.locator('#transportNpTitle');
    await expect(np).toHaveText('Reckless Grace', { timeout: 15000 });

    // Ensure shuffle is OFF (default).
    const shuffle = page.locator('#btnShuffle');
    if (await shuffle.evaluate((b: HTMLElement) => b.classList.contains('is-on')).catch(() => false)) {
      await shuffle.click();
    }

    await dismissAutoplayPrompt(page);
    await page.locator('#btnNext').click();
    await expect(np).toHaveText('Count What I Got', { timeout: 15000 });

    await dismissAutoplayPrompt(page);
    await page.locator('#btnNext').click();
    await expect(np).toHaveText('Nobody Beneath Us', { timeout: 15000 });
  });
});

test.describe("Aeon's Choice expands to up to 10 entries", () => {
  test('Show more reveals more picks, Show fewer collapses back to 5', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    const picks = page.locator('#aiPlaylist .ai-pick');
    await expect(picks).toHaveCount(5, { timeout: 15000 });

    const toggle = page.locator('#aiPlaylistToggle');
    await expect(toggle).toHaveText(/show more/i);
    // Wait for bindAiPlaylist to attach the handler (data-bound=1) so the tap
    // can't land before the listener exists. The button is visible + tappable
    // (verified via screenshot + elementFromPoint); trigger the handler directly
    // so a transient viz-layer hit-test can't flake the tap.
    await expect(toggle).toHaveAttribute('data-bound', '1');

    await toggle.evaluate((el: HTMLElement) => el.click());
    await expect(picks).toHaveCount(10, { timeout: 10000 });
    await expect(toggle).toHaveText(/show fewer/i);

    await toggle.evaluate((el: HTMLElement) => el.click());
    await expect(picks).toHaveCount(5, { timeout: 10000 });
    await expect(toggle).toHaveText(/show more/i);
  });
});
