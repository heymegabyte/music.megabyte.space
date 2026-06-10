#!/usr/bin/env node
// Verifies two things end-to-end:
//   1. Appeal modal opens, audio keeps playing across modal open+close, URL flips to /ashton then back.
//   2. Karaoke advances through the curated lines at the timestamps from public/lyrics/<id>.json.

import { chromium } from '/Users/apple/.npm/_npx/9833c18b2d85bc59/node_modules/playwright/index.mjs';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = resolve(import.meta.dirname, '..');
const SHOTS = resolve(ROOT, '.verify-shots');
await mkdir(SHOTS, { recursive: true });

const TRACK_ID = 'carry-the-light';
const lyrics = JSON.parse(await readFile(resolve(ROOT, `public/lyrics/${TRACK_ID}.json`), 'utf8'));
const expectedAt = [
  { t: 5, expectIdx: -1, label: 'pre-vocals (intro pad)' },
  { t: 20, expectIdx: 0, label: 'line 0 mid' },
  { t: 60, expectIdx: 1, label: 'line 1 mid' },
  { t: 100, expectIdx: 2, label: 'line 2 mid' },
  { t: 140, expectIdx: 3, label: 'line 3 mid' }
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error' || msg.type() === 'warning') consoleErrors.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', err => consoleErrors.push(`[pageerror] ${err.message}`));

console.log(`→ ${BASE}/`);
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

// Click first track to start playback. Browser policy needs user gesture to unlock audio.
const firstTrack = page.locator(`a[data-track="${TRACK_ID}"]`).first();
await firstTrack.click();
await page
  .waitForFunction(
    () => {
      const w = window;
      return w.__panda?.engine?.audio && !w.__panda.engine.audio.paused;
    },
    null,
    { timeout: 6000 }
  )
  .catch(() => {});

// Force unmuted play if autoplay was blocked.
await page.evaluate(() => {
  const a = window.__panda?.engine?.audio;
  if (a && a.paused) a.play().catch(() => {});
});
await page.waitForTimeout(500);

const before = await page.evaluate(() => {
  const a = window.__panda.engine.audio;
  return { paused: a.paused, currentTime: a.currentTime, src: a.currentSrc, ready: a.readyState };
});
console.log(`audio before appeal:`, before);

// Click the appeal link.
await page.click('#lnkAppeal');
await page.waitForSelector('dialog#appeal[open]', { timeout: 4000 });
await page.waitForFunction(() => location.pathname === '/ashton/');
await page.screenshot({ path: resolve(SHOTS, 'appeal-open.png'), fullPage: false });

// Wait for the iframe to render and verify it loaded the appeal page.
const iframeSrc = await page.evaluate(() => document.getElementById('appealFrame')?.src);
const iframeContentSrc = await page.evaluate(
  () => document.getElementById('appealFrame')?.contentWindow?.location?.href
);
console.log(`iframe.src attr: ${iframeSrc}`);
console.log(`iframe.contentWindow.location.href: ${iframeContentSrc}`);
const frame = page.frameLocator('#appealFrame');
await frame.locator('h1').waitFor({ state: 'visible', timeout: 5000 });
const headlineText = await frame.locator('h1').textContent();

// Verify audio is still playing while modal is open.
const during = await page.evaluate(() => {
  const a = window.__panda.engine.audio;
  return { paused: a.paused, currentTime: a.currentTime, dialogOpen: document.getElementById('appeal').open };
});
console.log(`audio during appeal:`, during, `headline: "${headlineText?.trim()}"`);

// Close via the iframe back button (postMessage path).
await frame.locator('#ctaBack').click();
await page.waitForFunction(() => !document.getElementById('appeal').open, null, { timeout: 4000 });
await page.waitForFunction(() => location.pathname !== '/ashton/');

const after = await page.evaluate(() => {
  const a = window.__panda.engine.audio;
  return { paused: a.paused, currentTime: a.currentTime };
});
console.log(`audio after close:`, after);

const audioSurvived =
  !before.paused &&
  !during.paused &&
  !after.paused &&
  during.currentTime >= before.currentTime - 0.1 &&
  after.currentTime >= during.currentTime - 0.1;
console.log(`audio survived modal lifecycle: ${audioSurvived ? 'PASS' : 'FAIL'}`);

// Also verify ESC closes it.
await page.click('#lnkAppeal');
await page.waitForSelector('dialog#appeal[open]');
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.getElementById('appeal').open, null, { timeout: 4000 });
await page.waitForFunction(() => location.pathname !== '/ashton/');
console.log(`ESC dismissal: PASS`);

// Karaoke advance check — seek to each timestamp, read #karCur, compare to expected line.
const karaokeResults = [];
for (const probe of expectedAt) {
  await page.evaluate(t => {
    const a = window.__panda.engine.audio;
    a.currentTime = t;
  }, probe.t);
  await page.waitForTimeout(220);
  const cur = await page.locator('#karCur').textContent();
  const expectedLine = probe.expectIdx >= 0 ? lyrics.lines[probe.expectIdx].text : '';
  const match = probe.expectIdx >= 0 ? cur?.trim() === expectedLine.trim() : true;
  karaokeResults.push({ ...probe, displayed: cur?.trim(), expected: expectedLine, match });
  await page.screenshot({ path: resolve(SHOTS, `karaoke-t${probe.t}.png`) });
}
console.table(
  karaokeResults.map(r => ({ t: r.t, label: r.label, match: r.match, displayed: r.displayed?.slice(0, 50) }))
);

const karaokeOk = karaokeResults.every(r => r.match);
console.log(`karaoke alignment: ${karaokeOk ? 'PASS' : 'FAIL'}`);
console.log(`console errors/warnings: ${consoleErrors.length}`);
if (consoleErrors.length) consoleErrors.slice(0, 10).forEach(e => console.log(`  ${e}`));

await browser.close();
process.exit(audioSurvived && karaokeOk ? 0 : 1);
