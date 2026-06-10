// Accessibility gate — axe-core WCAG 2.0/2.1 A + AA across the key surfaces.
// Fails on any serious/critical violation (the actionable tier); moderate/minor
// are logged but not gated, matching the project's pragmatic a11y bar.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SURFACES = ['/', '/about', '/credits', '/press', '/merch', '/privacy', '/terms'];

for (const path of SURFACES) {
  test(`a11y: ${path} has no serious/critical axe violations`, async ({ page }, info) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
    if (blocking.length) {
      console.log(`\n[${info.project.name}] ${path} — ${blocking.length} serious/critical:`);
      for (const v of blocking) console.log(`  ${v.id} (${v.impact}) ×${v.nodes.length} — ${v.help}`);
    }
    expect(blocking, blocking.map(v => `${v.id}: ${v.help}`).join('; ')).toEqual([]);
  });
}
