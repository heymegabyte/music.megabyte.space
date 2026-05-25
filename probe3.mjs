import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const all = [];
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warning') {
    const loc = m.location();
    all.push({ type: m.type(), text: m.text().slice(0, 250), url: loc.url || '', line: loc.lineNumber || 0 });
  }
});
await page.goto('https://music.megabyte.space/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);
console.log('=== ALL console errors/warnings (' + all.length + ') ===');
for (const m of all) console.log(`  [${m.type}] @ ${m.url}:${m.line}\n    ${m.text}`);
await browser.close();
