import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const v = [];
page.on('console', m => {
  const t = m.text();
  if (/TrustedHTML|TrustedScript|TrustedTypePolicy|Content Security|Loading the (font|stylesheet)/i.test(t)) {
    const loc = m.location();
    v.push({ url: loc.url, line: loc.lineNumber, text: t.slice(0, 180) });
  }
});
await page.goto('https://music.megabyte.space/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);
const ours = v.filter(x => !/cdn-cgi|about:blank|^:0$|^$/.test(x.url || ''));
const cfNoise = v.filter(x => /cdn-cgi|about:blank/.test(x.url || ''));
const unknown = v.filter(x => !x.url || x.url === ':0');
console.log('=== OUR-CODE violations:', ours.length, '===');
for (const x of ours) console.log(`  @ ${x.url}:${x.line}\n    ${x.text}`);
console.log('\n=== CF iframe noise:', cfNoise.length, '===');
console.log('\n=== unknown-source:', unknown.length, '===');
for (const x of unknown) console.log(`  ${x.text}`);
await browser.close();
