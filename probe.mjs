import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const v = [];
page.on('console', m => {
  const t = m.text();
  if (/TrustedHTML|TrustedScript|Content Security/i.test(t)) {
    const loc = m.location();
    v.push({ type: m.type(), text: t.slice(0, 200), url: loc.url, line: loc.lineNumber });
  }
});
await page.goto('https://music.megabyte.space/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);
console.log('=== violations captured: ' + v.length + ' ===');
for (const x of v) console.log(`  [${x.type}] @ ${x.url}:${x.line}\n    ${x.text}`);
await browser.close();
