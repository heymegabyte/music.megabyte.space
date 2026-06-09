// Merch cart flow — the money path. Real-user navigation from /merch:
// pick a size → add to cart (FAB badge increments, button shows "Added ✓") →
// open the cart via the FAB → drawer shows the line + subtotal → checkout
// POSTs to /api/merch/checkout and creates a real Stripe Checkout Session.
//
// Verified live 2026-06: the checkout button produces a cs_live_… session and
// redirects to checkout.stripe.com. We listen for the POST and stop before
// following that cross-origin redirect.
//
// Runs against PROD_URL via playwright.prod.config.ts. The interactive layer
// (.merch-card__add etc.) is injected by merch-cart.ts AFTER an async
// loadSuite() fetch, so hydration waits are generous.

import { test, expect } from '@playwright/test';

test.describe('merch cart', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.removeItem('bz-merch-cart-v1'); } catch { /* ignore */ }
    });
  });

  test('add → FAB → drawer shows line + subtotal, checkout reachable', async ({ page }) => {
    await page.goto('/merch');

    const firstAdd = page.locator('.merch-card__add').first();
    await expect(firstAdd).toBeVisible({ timeout: 30000 });

    // Adding does NOT auto-open the drawer — it bumps the FAB badge and flashes
    // "Added ✓" on the button. Assert that feedback instead of a drawer.
    await firstAdd.click();
    await expect(firstAdd).toContainText('Added', { timeout: 5000 });
    const badge = page.locator('.merch-fab__badge');
    await expect(badge).toHaveText(/[1-9][0-9]*/);

    // Open the cart via the FAB.
    await page.locator('.merch-fab').click();
    const subtotal = page.locator('#merchDrawerSubtotal');
    await expect(subtotal).toBeVisible();
    await expect(subtotal).not.toHaveText('$0.00');

    const checkout = page.locator('#merchDrawerCheckout');
    await expect(checkout).toBeVisible();
    await expect(checkout).toBeEnabled();
  });

  test('checkout posts a well-formed cart to /api/merch/checkout', async ({ page }) => {
    // INTERCEPT the checkout call so the test asserts the request shape WITHOUT
    // creating a real cs_live_ Stripe session on every run. (The genuine
    // end-to-end redirect to checkout.stripe.com was verified manually
    // 2026-06; a test must not spam live sessions.) We fulfil with a fake URL
    // the client won't actually navigate to within the assertion window.
    let captured: { items?: Array<{ slug: string; quantity: number }> } | null = null;
    await page.route('**/api/merch/checkout', async route => {
      try { captured = route.request().postDataJSON(); } catch { /* leave null */ }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'about:blank#mock-checkout' })
      });
    });

    await page.goto('/merch');
    const firstAdd = page.locator('.merch-card__add').first();
    await expect(firstAdd).toBeVisible({ timeout: 30000 });
    await firstAdd.click();
    await expect(firstAdd).toContainText('Added', { timeout: 5000 });

    await page.locator('.merch-fab').click();
    const checkoutBtn = page.locator('#merchDrawerCheckout');
    await expect(checkoutBtn).toBeVisible({ timeout: 10000 });
    await checkoutBtn.click();

    await expect.poll(() => captured, { timeout: 10000 }).not.toBeNull();
    expect(Array.isArray(captured!.items)).toBe(true);
    expect(captured!.items!.length).toBeGreaterThan(0);
    expect(captured!.items![0]).toHaveProperty('slug');
    expect(captured!.items![0]).toHaveProperty('quantity');
  });
});
