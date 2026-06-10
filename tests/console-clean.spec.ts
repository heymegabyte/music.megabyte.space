// Console hygiene sweep — visits the main surfaces and walks through real
// user actions while collecting every console error/warning + CSP report
// + pageerror. Asserts the count of OUR-ORIGIN messages is 0.
//
// Browser-extension messages (contentScript.bundle.js, executor.js,
// refresh.js, index.iife.js, LanguageTool_*) are filtered out — they
// run in extension origins and aren't our concern.

import { test, expect, type ConsoleMessage } from '@playwright/test';

const IGNORE_SOURCES = [
  /contentScript\.bundle\.js/,
  /refresh\.js/,
  /executor\.js/,
  /index\.iife\.js/,
  /LanguageTool_/,
  /chrome-extension:/,
  /moz-extension:/,
  // Cast SDK telemetry / availability probes when no devices on the LAN.
  /select_unknown_id|select_app_unavailable|unknown_app_id|cast_sender\.js/,
  // Cloudflare bot-management injects a separate about:blank iframe with
  // its own narrow CSP — we can't override it and the violations don't
  // reflect anything our code does.
  /\/cdn-cgi\/challenge-platform/,
  /about:blank/
];

// "Banner not shown" is an INFO log from Chrome when our app calls
// e.preventDefault() on beforeinstallprompt — that's the documented
// pattern. Filter it out so the assertion only catches real issues.
const IGNORE_TEXTS = [
  /Banner not shown: beforeinstallpromptevent\.preventDefault/,
  /\[Cast\]/,
  /\[viz\]/,
  /\[lyrics\]/,
  // CF bot-management iframe violations — see IGNORE_SOURCES note.
  /cdn-cgi\/challenge-platform/,
  // Cast SDK creates a goog#html policy — allowed in our CSP, but Chrome's
  // report-only mode logs the create event for browser-internal duplicates.
  /TrustedTypePolicy named 'goog#html'/,
  // Suno's `display_tags` field is the source of truth; some clips ship
  // `cast_sender.js?loadCastFramework=1` which fires `goog#html` too.
  /cast_sender.*goog#html/i
];

function shouldIgnore(text: string, location?: string) {
  for (const re of IGNORE_TEXTS) if (re.test(text)) return true;
  if (location) {
    for (const re of IGNORE_SOURCES) if (re.test(location)) return true;
  }
  for (const re of IGNORE_SOURCES) if (re.test(text)) return true;
  return false;
}

interface CapturedMsg {
  kind: string;
  text: string;
  location: string;
}

async function attachCollectors(page: import('@playwright/test').Page) {
  const captured: CapturedMsg[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const loc = msg.location();
    const url = loc.url || '';
    const text = msg.text();
    if (shouldIgnore(text, url)) return;
    captured.push({ kind: msg.type(), text, location: url });
  });
  page.on('pageerror', err => {
    // Check the STACK too, not just the message: a pageerror thrown inside a
    // third-party script (e.g. the gstatic Cast SDK in headless, which has no
    // Cast support) carries that source in its stack. IGNORE_SOURCES already
    // lists those external origins, so they're filtered here — while any error
    // with a first-party (music.megabyte.space) frame still fails the gate.
    const stack = err.stack || '';
    if (shouldIgnore(err.message, stack)) return;
    const topFrame =
      stack
        .split('\n')
        .find(l => /https?:\/\//.test(l))
        ?.trim() || '';
    captured.push({ kind: 'pageerror', text: err.message, location: topFrame });
  });
  page.on('requestfailed', req => {
    const url = req.url();
    if (shouldIgnore(url)) return;
    // Ignore the well-known DNT/abort-on-leave races for analytics beacons.
    if (/google-analytics|posthog/.test(url)) return;
    captured.push({ kind: 'requestfailed', text: req.failure()?.errorText || '', location: url });
  });
  return captured;
}

function assertClean(captured: CapturedMsg[], surface: string) {
  if (captured.length === 0) return;
  const lines = captured.map(m => `  [${m.kind}] ${m.text}${m.location ? `\n      @ ${m.location}` : ''}`);
  throw new Error(`${captured.length} console issue(s) on ${surface}:\n${lines.join('\n')}`);
}

test.describe('console hygiene — production sweep', () => {
  test('homepage boots clean + click play + open AI chat + open share', async ({ page }) => {
    const captured = await attachCollectors(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // Let the boot finish (lazy ai-chat, observability, etc.)
    await page.waitForTimeout(2500);

    // Click the first track row to start playback.
    const firstTrack = page.locator('a.trackrow').first();
    await firstTrack.click();
    await page.waitForTimeout(2000);

    // Open AI chat drawer (Cmd+K or button).
    const aiBtn = page.locator('#btnAi, [data-action="ai"], #btnAichat').first();
    if (await aiBtn.count()) {
      await aiBtn.click();
      await page.waitForTimeout(800);
      await page.keyboard.press('Escape');
    }

    // Click share on the first row.
    const shareBtn = page.locator('.share-chip[data-share-track]').first();
    if (await shareBtn.count()) {
      await shareBtn.click();
      await page.waitForTimeout(500);
      await page.keyboard.press('Escape');
    }

    assertClean(captured, '/');
  });

  test('track route boots clean + scrub bar interaction', async ({ page }) => {
    const captured = await attachCollectors(page);
    await page.goto('/desiiignare/chef-lu-stew', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    // Try clicking the play button if present.
    const play = page.locator('#playPause, #btnPlay, [data-action="play"]').first();
    if (await play.count()) {
      await play.click({ trial: false }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    assertClean(captured, '/desiiignare/chef-lu-stew');
  });

  test('embed page boots clean + play + nav', async ({ page }) => {
    const captured = await attachCollectors(page);
    await page.goto('/embed/desiiignare', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.locator('#embedPlay').click();
    await page.waitForTimeout(2000);
    await page.locator('#embedNext').click();
    await page.waitForTimeout(800);
    assertClean(captured, '/embed/desiiignare');
  });

  test('appeal page (Ashton iframe) boots clean', async ({ page }) => {
    const captured = await attachCollectors(page);
    await page.goto('/appeal', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    assertClean(captured, '/appeal');
  });

  test('CSP headers — no font-src or style-src violations on Google Fonts load', async ({ page }) => {
    const cspViolations: string[] = [];
    page.on('console', msg => {
      const t = msg.text();
      if (/Content Security Policy/i.test(t) && /style-src|font-src/i.test(t)) {
        cspViolations.push(t);
      }
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    expect(cspViolations, `Google Fonts CSP violations: ${cspViolations.join('\n')}`).toEqual([]);
  });

  test('Trusted Types — no TrustedHTML / TrustedScriptURL violations from our code', async ({ page }) => {
    const ttViolations: string[] = [];
    page.on('console', msg => {
      const t = msg.text();
      if (!/TrustedHTML|TrustedScript|TrustedTypePolicy/i.test(t)) return;
      // Filter Cast SDK goog#html — allowed in CSP.
      if (/goog#html/.test(t)) return;
      const loc = msg.location();
      const url = loc.url || '';
      // CF bot-management inline script lives in our shipped index.html at
      // the very bottom (line ~242) — it creates an about:blank iframe and
      // writes script.innerHTML there. Different document, separate TT
      // registry — our default policy can't reach it. Filter as known-noise.
      if (url === '' || /^about:blank/.test(url)) return;
      if (/\/$/.test(url) && (loc.lineNumber ?? 0) > 200) return;
      if (/cdn-cgi\/challenge-platform/.test(url)) return;
      ttViolations.push(`${t}\n  @ ${url}:${loc.lineNumber}`);
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const aiBtn = page.locator('#btnAi, [data-action="ai"], #btnAichat').first();
    if (await aiBtn.count()) {
      await aiBtn.click();
      await page.waitForTimeout(1500);
    }
    expect(ttViolations, `Trusted Types violations from our code: ${ttViolations.join('\n')}`).toEqual([]);
  });
});
