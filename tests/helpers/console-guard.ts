// Shared console/network hygiene collector for prod E2E specs. Attaches to a
// page, captures every console error/warning + pageerror + requestfailed, and
// filters out noise that isn't our code (browser extensions, Cast LAN probes,
// Cloudflare bot-management iframe, analytics beacon abort races). Reused by the
// console-clean sweep and the feature-matrix suite so the ignore-list lives once.
import type { Page, ConsoleMessage } from '@playwright/test';

const IGNORE_SOURCES = [
  /contentScript\.bundle\.js/,
  /refresh\.js/,
  /executor\.js/,
  /index\.iife\.js/,
  /LanguageTool_/,
  /chrome-extension:/,
  /moz-extension:/,
  /select_unknown_id|select_app_unavailable|unknown_app_id|cast_sender\.js/,
  /\/cdn-cgi\/challenge-platform/,
  /about:blank/,
  // Error/analytics beacons abort on page-leave under Playwright — not a fault.
  /\/api\/error/,
  /\/api\/vitals/,
  /\/api\/csp-report/
];
const IGNORE_TEXTS = [
  /Banner not shown: beforeinstallpromptevent\.preventDefault/,
  /\[cast\]/i,
  /\[viz\]/i,
  /\[lyrics\]/i,
  /\[playback\]/i,
  /cdn-cgi\/challenge-platform/,
  /TrustedTypePolicy named 'goog#html'/,
  /cast_sender.*goog#html/i,
  // Test-harness only: the prod config blocks service workers, so the app's
  // SW registration logs this warning. Not a site error.
  /Service Worker registration blocked by Playwright/i,
  // Headless Chrome has no Cast environment, so the Google Cast SDK never
  // initialises window.chrome.cast — our (handled) init + the SDK's own internals
  // throw here. The REAL site (with the SDK present) casts fine; these are
  // environment artifacts, not prod faults.
  /AutoJoinPolicy/,
  /cast options failed/i,
  /Cannot read properties of undefined \(reading 'media'\)/,
  /\/api\/error/,
  /net::ERR_ABORTED/
];

export function shouldIgnore(text: string, location?: string): boolean {
  for (const re of IGNORE_TEXTS) if (re.test(text)) return true;
  if (location) for (const re of IGNORE_SOURCES) if (re.test(location)) return true;
  for (const re of IGNORE_SOURCES) if (re.test(text)) return true;
  return false;
}

export interface CapturedMsg {
  kind: string;
  text: string;
  location: string;
}

export function attachConsoleGuard(page: Page): CapturedMsg[] {
  const captured: CapturedMsg[] = [];
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const url = msg.location().url || '';
    const text = msg.text();
    if (shouldIgnore(text, url)) return;
    captured.push({ kind: msg.type(), text, location: url });
  });
  page.on('pageerror', err => {
    if (shouldIgnore(err.message)) return;
    captured.push({ kind: 'pageerror', text: err.message, location: '' });
  });
  page.on('requestfailed', req => {
    const url = req.url();
    if (shouldIgnore(url)) return;
    if (/google-analytics|posthog/.test(url)) return; // beacon abort-on-leave races
    captured.push({ kind: 'requestfailed', text: req.failure()?.errorText || '', location: url });
  });
  return captured;
}

export function assertClean(captured: CapturedMsg[], surface: string): void {
  if (captured.length === 0) return;
  const lines = captured.map(m => `  [${m.kind}] ${m.text}${m.location ? `\n      @ ${m.location}` : ''}`);
  throw new Error(`${captured.length} console issue(s) on ${surface}:\n${lines.join('\n')}`);
}
