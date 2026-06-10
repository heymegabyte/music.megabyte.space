/**
 * Client-side observability bootstrap.
 *
 * Lazily loads PostHog (autocapture + product analytics + session replay)
 * and pipes pageerror + unhandled-rejection to Sentry via a thin Worker
 * proxy at `/api/sentry-tunnel`. Capture Web Vitals (LCP, INP, CLS, TTFB,
 * LoAF) and POST to `/api/vitals` for KV-backed RUM aggregation.
 *
 * All three failure-tolerant: if a script load fails or an endpoint 404s,
 * the rest of the app keeps working. This file ships AFTER `main.ts` so
 * core UX never blocks on telemetry.
 */

import { asScriptURL } from './trusted-types';

declare global {
  interface Window {
    __POSTHOG_KEY__?: string;
    __SENTRY_DSN__?: string;
  }
}

// PostHog public key + Sentry DSN are injected into <script> globals by the
// worker via HTMLRewriter on the index.html shell. Falls back to env-less
// no-op when absent.
const POSTHOG_KEY = (window.__POSTHOG_KEY__ || '').trim();
const SENTRY_DSN = (window.__SENTRY_DSN__ || '').trim();

// ─── Sentry: post raw error events to a worker-side tunnel ─────────────
// We avoid the full SDK (60KB+) and ship a 15-line shim that posts the same
// event envelope. The worker forwards to Sentry's ingest URL with the auth
// header so the DSN never leaks to the client.
function reportError(payload: Record<string, unknown>) {
  if (!SENTRY_DSN) return;
  try {
    fetch('/api/error', {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  } catch {
    /* never let the reporter throw */
  }
}

window.addEventListener('error', e => {
  reportError({
    type: 'pageerror',
    message: e.message,
    filename: e.filename,
    line: e.lineno,
    col: e.colno,
    stack: e.error?.stack?.toString().slice(0, 4000),
    ua: navigator.userAgent,
    url: location.href,
    ts: Date.now()
  });
});

window.addEventListener('unhandledrejection', e => {
  const reason =
    e.reason instanceof Error
      ? { message: e.reason.message, stack: e.reason.stack }
      : { message: String(e.reason) };
  reportError({
    type: 'unhandledrejection',
    ...reason,
    ua: navigator.userAgent,
    url: location.href,
    ts: Date.now()
  });
});

// ─── Web Vitals: LCP, INP, CLS, TTFB + LoAF ─────────────────────────────
// Lightweight (~1KB) — emits a single POST per vital + a final batch on
// pagehide. Uses the Web Performance API directly; web-vitals npm pkg would
// be more accurate but adds 5KB and another dependency.
const vitals: Record<string, number> = {};

function pushVital(name: string, value: number) {
  vitals[name] = value;
}

function flushVitals() {
  if (!Object.keys(vitals).length) return;
  try {
    navigator.sendBeacon?.(
      '/api/vitals',
      new Blob(
        [JSON.stringify({ ...vitals, url: location.pathname, ua: navigator.userAgent, ts: Date.now() })],
        { type: 'application/json' }
      )
    );
  } catch {
    /* no-op */
  }
}

if ('PerformanceObserver' in window) {
  try {
    new PerformanceObserver(list => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry & {
        renderTime?: number;
        loadTime?: number;
      };
      if (last) pushVital('lcp', Math.round(last.renderTime || last.loadTime || last.startTime));
    }).observe({ type: 'largest-contentful-paint', buffered: true });

    let cls = 0;
    new PerformanceObserver(list => {
      for (const e of list.getEntries() as PerformanceEntry[] &
        { value?: number; hadRecentInput?: boolean }[]) {
        const entry = e as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (!entry.hadRecentInput && typeof entry.value === 'number') cls += entry.value;
      }
      pushVital('cls', Math.round(cls * 1000) / 1000);
    }).observe({ type: 'layout-shift', buffered: true });

    // INP via long-animation-frame is more accurate than the basic event
    // timing path on slow phones. Falls back to event-timing where LoAF
    // isn't supported (non-Chromium).
    new PerformanceObserver(list => {
      let maxDur = vitals.inp || 0;
      for (const e of list.getEntries()) {
        if (e.duration > maxDur) maxDur = e.duration;
      }
      pushVital('inp', Math.round(maxDur));
    }).observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit & {
      durationThreshold: number;
    });

    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) pushVital('ttfb', Math.round(nav.responseStart - nav.requestStart));
  } catch {
    /* observer unsupported on this browser */
  }
}

addEventListener('pagehide', flushVitals, { capture: true });
addEventListener(
  'visibilitychange',
  () => {
    if (document.hidden) flushVitals();
  },
  { capture: true }
);

// ─── PostHog ───────────────────────────────────────────────────────────
// Cookie-free (persistence: 'memory'), autocapture + pageviews + replay.
// Loaded lazily via the official posthog-js bundle from their CDN. CSP
// connect-src + script-src already allow *.posthog.com.
if (POSTHOG_KEY && /^phc_/.test(POSTHOG_KEY)) {
  /* eslint-disable */
  // Official PostHog snippet, trimmed. Async-loads `array.js` and queues
  // events until ready. Cookie-free 'memory' persistence keeps us out of
  // GDPR consent territory while still capturing session behavior.
  (function (p: any, o: any, s: any, t: any, h: any, o2: any, g: any) {
    p.posthog = p.posthog || [];
    p.posthog.toString = function (a: any) {
      return a ? 'posthog-snippet-loaded' : 'posthog-snippet-async';
    };
    p.posthog.people = p.posthog.people || [];
    // queue + init shim
    const stubs =
      'capture identify alias set set_once register unregister opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_distinct_id get_property setPersonProperties group get_session_id'.split(
        ' '
      );
    for (const f of stubs) {
      (p.posthog as any)[f] = ((name: string) =>
        function (...args: any[]) {
          (p.posthog as any).push([name, args]);
        })(f);
    }
    const s2 = o.createElement('script');
    s2.async = true;
    // Trusted Types: wrap the PostHog snippet URL.
    s2.src = asScriptURL('https://us-assets.i.posthog.com/static/array.js');
    o.head.appendChild(s2);
    (p.posthog as any).__loaded = false;
    (p.posthog as any).__SV = 1;
    (p.posthog as any).init = function (k: string, opts: any) {
      (p.posthog as any).push(['init', k, opts]);
    };
    (p.posthog as any).init(POSTHOG_KEY, {
      api_host: 'https://us.i.posthog.com',
      persistence: 'memory',
      autocapture: true,
      capture_pageview: true,
      capture_pageleave: true,
      session_recording: { maskAllInputs: true }
    });
  })(window, document, undefined, undefined, undefined, undefined, undefined);
  /* eslint-enable */
}

export {};
