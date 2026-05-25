import { SEO_INDEX, type RouteSeo } from '../src/track-meta';
import { TRACK_BY_ID, ALBUM_BY_ID } from '../src/data';
import { sendPushBatch, type PushSubscriptionRecord } from './web-push';
import { escapeXmlText, escapeHtmlAttr } from './escape';
import { serializeJsonLd } from './json-ld';

interface Env {
  ASSETS: Fetcher;
  COUNTERS: KVNamespace;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string; // JSON-stringified JsonWebKey
  VAPID_SUBJECT?: string;     // mailto:brian@megabyte.space
  PUSH_ADMIN_TOKEN?: string;  // Bearer token gating /api/push/send
  LISTMONK_URL?: string;      // e.g. https://listmonk.megabyte.space
  LISTMONK_API_USER?: string; // API user name (e.g. "automation")
  LISTMONK_API_TOKEN?: string;// API token (secret)
  LISTMONK_LIST_NAME?: string;// Display name for the list (default: "music.megabyte.space")
  LISTMONK_LIST_ID?: string;  // Optional pinned list id; if unset, worker auto-discovers/creates
  // Listmonk transactional template IDs for Foundation flows. See
  // worker/listmonk-templates/README.md for upload + secret-set steps.
  LISTMONK_TPL_WELCOME?: string;
  LISTMONK_TPL_FIRST_MONTH_D3?: string;
  LISTMONK_TPL_FIRST_MONTH_D10?: string;
  LISTMONK_TPL_FIRST_MONTH_D21?: string;
  LISTMONK_TPL_WINBACK?: string;
  ANTHROPIC_API_KEY?: string; // For /api/ai/chat — Claude Haiku 4.5 streaming
  ANTHROPIC_MODEL?: string;   // Override default model (claude-haiku-4-5-20251001)
  CF_AI_GATEWAY_SLUG?: string;// Cloudflare AI Gateway slug for caching+logging
  SENTRY_DSN?: string;        // @sentry/cloudflare DSN for exception capture
  POSTHOG_PUBLIC_KEY?: string;// PostHog public key (forwarded to client snippet)
  TURNSTILE_SECRET_KEY?: string; // Server-side Turnstile verification secret
}

const CF_ACCOUNT_ID = '84fa0d1b16ff8086dd958c468ce7fd59';

// Recognized origins the worker serves from. bzmusic.win is the new
// primary surface; music.megabyte.space is the legacy alias that stays
// live for SEO + back-link continuity. Use these constants in CORS +
// canonical computation + oEmbed host validation.
const ALLOWED_HOSTS = new Set([
  'music.megabyte.space',
  'bzmusic.win',
  'www.bzmusic.win'
]);

const VALID_TRACK_ID = /^[a-z0-9-]{1,80}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Returns the appropriate `Access-Control-Allow-Origin` header value for
 * the inbound request. Echoes the request's Origin when it's one of the
 * allowed hosts; otherwise falls back to bzmusic.win (new primary).
 */
function corsOrigin(request: Request): string {
  const origin = request.headers.get('origin') || '';
  try {
    const host = new URL(origin).host;
    if (ALLOWED_HOSTS.has(host)) return origin;
  } catch { /* invalid origin header */ }
  return 'https://bzmusic.win';
}

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}, request?: Request): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': request ? corsOrigin(request) : 'https://bzmusic.win',
    ...extra
  };
  return new Response(JSON.stringify(body), { status, headers });
}

async function readCount(kv: KVNamespace, key: string): Promise<number> {
  const raw = await kv.get(key);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function bumpCounter(kv: KVNamespace, key: string): Promise<number> {
  const next = (await readCount(kv, key)) + 1;
  await kv.put(key, String(next));
  return next;
}

async function rateLimited(kv: KVNamespace, ip: string, scope: string, id: string, ttlSec: number): Promise<boolean> {
  const key = `rl:${scope}:${ip}:${id}`;
  const hit = await kv.get(key);
  if (hit) return true;
  await kv.put(key, '1', { expirationTtl: ttlSec });
  return false;
}

/**
 * Counting rate limit — allows N requests inside a TTL window. KV is
 * eventually consistent so two parallel hits at the boundary can both pass,
 * but the global slop is small (≤5%) and acceptable for chat traffic.
 * Returns true when the caller has exceeded the limit.
 */
async function rateLimitedCount(
  kv: KVNamespace,
  ip: string,
  scope: string,
  windowKey: string,
  limit: number,
  ttlSec: number
): Promise<boolean> {
  const key = `rlc:${scope}:${ip}:${windowKey}`;
  const cur = parseInt((await kv.get(key)) || '0', 10);
  if (cur >= limit) return true;
  await kv.put(key, String(cur + 1), { expirationTtl: ttlSec });
  return false;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

interface ListmonkListLite { id: number; name: string }
interface ListmonkResp<T> { data?: T; message?: string }

function listmonkConfigured(env: Env): boolean {
  return Boolean(env.LISTMONK_URL && env.LISTMONK_API_USER && env.LISTMONK_API_TOKEN);
}

function listmonkAuthHeaders(env: Env): Record<string, string> {
  return {
    'Authorization': `token ${env.LISTMONK_API_USER}:${env.LISTMONK_API_TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'music.megabyte.space/1.0 (Cloudflare Workers)'
  };
}

async function resolveListmonkListId(env: Env, kv: KVNamespace): Promise<number | null> {
  if (env.LISTMONK_LIST_ID) {
    const n = Number(env.LISTMONK_LIST_ID);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const cached = await kv.get('listmonk:list-id');
  if (cached) {
    const n = Number(cached);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const targetName = env.LISTMONK_LIST_NAME || 'music.megabyte.space';
  const base = (env.LISTMONK_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  // Search for an existing list by name
  try {
    const url = `${base}/api/lists?query=${encodeURIComponent(targetName)}&per_page=100`;
    const res = await fetch(url, { headers: listmonkAuthHeaders(env) });
    if (res.ok) {
      const json = await res.json() as ListmonkResp<{ results?: ListmonkListLite[]; total?: number }>;
      const results = json.data?.results || [];
      const match = results.find(l => l.name === targetName) || results[0];
      if (match?.id) {
        await kv.put('listmonk:list-id', String(match.id), { expirationTtl: 60 * 60 * 24 * 7 });
        return match.id;
      }
    }
  } catch { /* fall through to create */ }
  // Create the list if not found
  try {
    const res = await fetch(`${base}/api/lists`, {
      method: 'POST',
      headers: listmonkAuthHeaders(env),
      body: JSON.stringify({ name: targetName, type: 'public', optin: 'single', tags: ['music', 'bz', 'drops'] })
    });
    if (res.ok) {
      const json = await res.json() as ListmonkResp<ListmonkListLite>;
      const id = json.data?.id;
      if (id) {
        await kv.put('listmonk:list-id', String(id), { expirationTtl: 60 * 60 * 24 * 7 });
        return id;
      }
    }
  } catch { /* return null below */ }
  return null;
}

/** Fire a Listmonk transactional email by template ID. The transactional
 *  endpoint expects { subscriber_email, template_id, data?, content_type? }.
 *  Failures swallowed at call site — never block subscribe success on a
 *  template send. Returns the listmonk response status for diagnostics. */
async function sendListmonkTransactional(
  env: Env,
  templateId: string | undefined,
  email: string,
  data: Record<string, unknown> = {}
): Promise<{ ok: boolean; status: number; message?: string }> {
  if (!listmonkConfigured(env) || !templateId) return { ok: false, status: 0, message: 'not_configured' };
  const base = (env.LISTMONK_URL || '').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/tx`, {
      method: 'POST',
      headers: listmonkAuthHeaders(env),
      body: JSON.stringify({
        subscriber_email: email,
        template_id: Number(templateId),
        data,
        content_type: 'html'
      })
    });
    if (res.ok) return { ok: true, status: res.status };
    const txt = await res.text();
    return { ok: false, status: res.status, message: txt.slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Daily Foundation-flow cron: hit Listmonk subscribers list, identify
 *  which subscribers fall in the day-3/day-10/day-21 first-month windows
 *  + the 90-day winback window, and trigger the matching transactional
 *  template. Idempotent — uses a KV-backed "fired:<template>:<email>"
 *  flag to prevent double-sends across cron runs.
 *
 *  Triggered by the cron in wrangler.toml ('0 9 * * *' = 09:00 UTC daily)
 *  or manually via /api/listmonk/foundation-cron?token=<PUSH_ADMIN_TOKEN>. */
async function runFoundationFlowsCron(env: Env, kv: KVNamespace): Promise<{
  ok: boolean;
  scanned: number;
  fired: Record<string, number>;
  errors: string[];
}> {
  const fired: Record<string, number> = { day3: 0, day10: 0, day21: 0, winback: 0 };
  const errors: string[] = [];
  if (!listmonkConfigured(env)) {
    return { ok: false, scanned: 0, fired, errors: ['listmonk_not_configured'] };
  }
  const base = (env.LISTMONK_URL || '').replace(/\/+$/, '');
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  // Inclusive window of ±12h around the target day so daily cron always
  // catches each subscriber exactly once per stage.
  const inWindow = (createdAtMs: number, days: number) => {
    const target = now - days * DAY_MS;
    return Math.abs(createdAtMs - target) <= 12 * 60 * 60 * 1000;
  };
  let scanned = 0;
  // Paginate up to 50 pages × 100 = 5000 subscribers. Beyond that, Listmonk
  // Pro's segmentation is the right tool; this is a starter implementation.
  for (let page = 1; page <= 50; page++) {
    let data: { data?: { results?: Array<{ email: string; created_at: string; last_active_at?: string }>; total?: number } };
    try {
      const res = await fetch(`${base}/api/subscribers?per_page=100&page=${page}`, {
        headers: listmonkAuthHeaders(env)
      });
      if (!res.ok) {
        errors.push(`listmonk_subscribers ${res.status} page=${page}`);
        break;
      }
      data = await res.json() as typeof data;
    } catch (err) {
      errors.push(`listmonk_fetch ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
    const results = data?.data?.results || [];
    if (!results.length) break;
    for (const sub of results) {
      scanned++;
      const created = Date.parse(sub.created_at || '');
      const lastActive = sub.last_active_at ? Date.parse(sub.last_active_at) : created;
      if (!Number.isFinite(created)) continue;
      // First-month flow stages
      const stages: Array<{ days: number; key: keyof typeof fired; tpl: string | undefined }> = [
        { days: 3, key: 'day3', tpl: env.LISTMONK_TPL_FIRST_MONTH_D3 },
        { days: 10, key: 'day10', tpl: env.LISTMONK_TPL_FIRST_MONTH_D10 },
        { days: 21, key: 'day21', tpl: env.LISTMONK_TPL_FIRST_MONTH_D21 }
      ];
      for (const stage of stages) {
        if (!stage.tpl) continue;
        if (!inWindow(created, stage.days)) continue;
        const dedupeKey = `fired:${stage.key}:${sub.email}`;
        if (await kv.get(dedupeKey)) continue;
        const r = await sendListmonkTransactional(env, stage.tpl, sub.email);
        if (r.ok) {
          fired[stage.key]++;
          // 60-day dedupe TTL — well past the stage window so we never re-fire.
          await kv.put(dedupeKey, String(now), { expirationTtl: 60 * 24 * 60 * 60 });
        } else if (r.status) {
          errors.push(`${stage.key}:${sub.email} status=${r.status} ${r.message || ''}`);
        }
      }
      // Winback: ≥90 days since last open AND created ≥90 days ago.
      const ninetyDaysAgo = now - 90 * DAY_MS;
      if (
        env.LISTMONK_TPL_WINBACK &&
        Number.isFinite(lastActive) &&
        lastActive < ninetyDaysAgo &&
        created < ninetyDaysAgo
      ) {
        const dedupeKey = `fired:winback:${sub.email}`;
        if (!(await kv.get(dedupeKey))) {
          const r = await sendListmonkTransactional(env, env.LISTMONK_TPL_WINBACK, sub.email);
          if (r.ok) {
            fired.winback++;
            // 180-day TTL so we don't winback the same person again within 6 months.
            await kv.put(dedupeKey, String(now), { expirationTtl: 180 * 24 * 60 * 60 });
          } else if (r.status) {
            errors.push(`winback:${sub.email} status=${r.status} ${r.message || ''}`);
          }
        }
      }
    }
    if (results.length < 100) break;
  }
  return { ok: true, scanned, fired, errors };
}

async function subscribeToListmonk(
  env: Env,
  kv: KVNamespace,
  email: string,
  source: string
): Promise<{ ok: boolean; status: 'subscribed' | 'already' | 'error'; message?: string }> {
  if (!listmonkConfigured(env)) return { ok: false, status: 'error', message: 'listmonk_not_configured' };
  const listId = await resolveListmonkListId(env, kv);
  const base = (env.LISTMONK_URL || '').replace(/\/+$/, '');
  const body = {
    email,
    name: email.split('@')[0],
    status: 'enabled' as const,
    lists: listId ? [listId] : [],
    preconfirm_subscriptions: true,
    attribs: { source, signed_up_at: new Date().toISOString() }
  };
  try {
    const res = await fetch(`${base}/api/subscribers`, {
      method: 'POST',
      headers: listmonkAuthHeaders(env),
      body: JSON.stringify(body)
    });
    if (res.ok) return { ok: true, status: 'subscribed' };
    // Listmonk returns 409 / 400 with "already exists" — treat as soft-success and re-attach to list.
    const text = await res.text();
    if (/already exists|duplicate|unique/i.test(text)) {
      if (listId) {
        await fetch(`${base}/api/subscribers/lists`, {
          method: 'PUT',
          headers: listmonkAuthHeaders(env),
          body: JSON.stringify({ ids: [], emails: [email], action: 'add', target_list_ids: [listId], status: 'confirmed' })
        }).catch(() => {});
      }
      return { ok: true, status: 'already' };
    }
    return { ok: false, status: 'error', message: text.slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

async function listSubscriptions(kv: KVNamespace): Promise<PushSubscriptionRecord[]> {
  const out: PushSubscriptionRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: 'push:', cursor, limit: 1000 });
    for (const k of page.keys) {
      const raw = await kv.get(k.name);
      if (!raw) continue;
      try {
        const sub = JSON.parse(raw) as PushSubscriptionRecord;
        if (sub.endpoint && sub.keys?.p256dh && sub.keys?.auth) out.push(sub);
      } catch { /* skip */ }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'X-Frame-Options': 'DENY',
  // Report-only — measure real violations before promoting to enforcing. Tuned
  // for the current load pattern: Vite-bundled self scripts, CF Insights beacon,
  // Cast SDK from gstatic, JSON-LD inline blocks, service worker, /api/* fetches.
  // PostHog (eu.posthog.com / us.posthog.com) + GA4 + Sentry CDN added when
  // those snippets are wired into the HTML head.
  'Content-Security-Policy-Report-Only': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://www.gstatic.com https://*.posthog.com https://www.googletagmanager.com",
    "script-src-elem 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://www.gstatic.com https://*.posthog.com https://www.googletagmanager.com",
    // Google Fonts stylesheet must be allowed for the Sora + Space Grotesk
    // + JetBrains Mono + display fonts loaded from index.html.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // QR codes load from api.qrserver.com — already covered by `https:` here.
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: data: https:",
    // Google Fonts woff2 files are served from fonts.gstatic.com.
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://*.cloudflareinsights.com https://*.posthog.com https://www.google-analytics.com https://region1.google-analytics.com",
    "worker-src 'self' blob:",
    "frame-src 'self' https://*.gstatic.com https://open.spotify.com https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    // Trusted Types — report-only audit phase. `default` is the app's
    // passthrough policy installed at boot (see src/trusted-types.ts).
    // `goog#html` is Google Cast SDK's internal policy — required when
    // the user starts a cast session. `allow-duplicates` covers per-tab
    // re-installs during HMR + iframe boots. Browser-extension policies
    // (LanguageTool_Executor_Policy, etc.) are NOT listed here — they
    // run in extension origins, not ours.
    "require-trusted-types-for 'script'",
    "trusted-types 'allow-duplicates' default goog#html",
    "report-uri /api/csp-report"
  ].join('; ')
};

class MetaRewriter {
  constructor(private seo: RouteSeo) {}

  element(el: Element) {
    const name = el.tagName.toLowerCase();
    if (name === 'title') {
      // HTMLRewriter.setInnerContent HTML-escapes by default; no pre-escape.
      el.setInnerContent(this.seo.title);
      return;
    }
    const property = el.getAttribute('property') || '';
    const metaName = el.getAttribute('name') || '';
    const rel = el.getAttribute('rel') || '';
    const linkType = el.getAttribute('type') || '';
    const hasAudio = Boolean(this.seo.audioUrl);

    if (rel === 'canonical') {
      el.setAttribute('href', this.seo.canonical);
      return;
    }
    if (rel === 'alternate' && linkType === 'application/json+oembed') {
      if (this.seo.oembedUrl) {
        el.setAttribute('href', this.seo.oembedUrl);
      } else {
        el.remove();
      }
      return;
    }
    if (rel === 'alternate' && linkType === 'text/xml+oembed') {
      if (this.seo.oembedUrl) {
        el.setAttribute('href', this.seo.oembedUrl.replace('format=json', 'format=xml'));
      } else {
        el.remove();
      }
      return;
    }
    switch (metaName) {
      case 'description':
        el.setAttribute('content', this.seo.description);
        return;
      case 'twitter:card':
        el.setAttribute('content', hasAudio ? 'player' : 'summary_large_image');
        return;
      case 'twitter:title':
        el.setAttribute('content', this.seo.twitterTitle);
        return;
      case 'twitter:description':
        el.setAttribute('content', this.seo.twitterDescription);
        return;
      case 'twitter:image':
        el.setAttribute('content', this.seo.twitterImage);
        return;
      case 'twitter:image:alt':
        el.setAttribute('content', this.seo.ogImageAlt);
        return;
      case 'twitter:player':
        if (this.seo.embedUrl) el.setAttribute('content', this.seo.embedUrl);
        else el.remove();
        return;
      case 'twitter:player:width':
        if (this.seo.embedWidth) el.setAttribute('content', String(this.seo.embedWidth));
        else el.remove();
        return;
      case 'twitter:player:height':
        if (this.seo.embedHeight) el.setAttribute('content', String(this.seo.embedHeight));
        else el.remove();
        return;
      case 'twitter:player:stream':
        if (this.seo.audioUrl) el.setAttribute('content', this.seo.audioUrl);
        else el.remove();
        return;
      case 'twitter:player:stream:content_type':
        if (!this.seo.audioUrl) el.remove();
        return;
    }
    switch (property) {
      case 'og:type':
        el.setAttribute('content', this.seo.ogType);
        return;
      case 'og:title':
        el.setAttribute('content', this.seo.ogTitle);
        return;
      case 'og:description':
        el.setAttribute('content', this.seo.ogDescription);
        return;
      case 'og:url':
        el.setAttribute('content', this.seo.canonical);
        return;
      case 'og:image':
      case 'og:image:secure_url':
        el.setAttribute('content', this.seo.ogImage);
        return;
      case 'og:image:type':
        el.setAttribute('content', /\.png(\?|$)/i.test(this.seo.ogImage) ? 'image/png' : 'image/jpeg');
        return;
      case 'og:image:alt':
        el.setAttribute('content', this.seo.ogImageAlt);
        return;
      case 'og:audio':
      case 'og:audio:secure_url':
        if (this.seo.audioUrl) el.setAttribute('content', this.seo.audioUrl);
        else el.remove();
        return;
      case 'og:audio:type':
        if (!this.seo.audioUrl) el.remove();
        return;
    }
  }
}

/** Append a route-scoped SEO body inside `<body>`. Wrapped in a `<details>`
 * so crawlers + AI scrapers index the 300-1000 word narrative while sighted
 * users see only a discreet "About this track" expander below the player.
 * Same content for users + bots — not cloaking. */
class SeoBodyRewriter {
  private appended = false;
  constructor(private seo: RouteSeo) {}

  element(el: Element) {
    if (this.appended) return;
    this.appended = true;
    const safePath = this.seo.path.replace(/[^a-z0-9\-/_]/gi, '');
    const block = `<aside class="route-seo-body" data-route="${safePath}">
<details class="route-seo-details">
<summary>About this page</summary>
<div class="route-seo-prose">${this.seo.seoBody}</div>
</details>
</aside>`;
    el.append(block, { html: true });
  }
}

/**
 * Injects telemetry globals into the HTML <head> so observability.ts can
 * read `window.__POSTHOG_KEY__` + `window.__SENTRY_DSN__` without the keys
 * ever being baked into the static bundle. Keys originate from worker
 * secrets so they rotate without redeploying frontend code.
 *
 * The injected snippet is small enough that the inline `'unsafe-inline'`
 * script-src allowance covers it. When CSP promotes to strict-dynamic, this
 * block needs a per-request nonce — track that in citations.md follow-up.
 */
class TelemetryRewriter {
  constructor(private env: Env) {}
  element(el: Element) {
    const key = (this.env.POSTHOG_PUBLIC_KEY || '').replace(/[^a-zA-Z0-9_-]/g, '');
    // We don't expose the full Sentry DSN — observability.ts only needs to
    // know "enabled" so it pipes events to /api/error. Worker keeps the DSN.
    const sentryEnabled = !!this.env.SENTRY_DSN;
    const snippet = `<script>window.__POSTHOG_KEY__=${JSON.stringify(key)};window.__SENTRY_DSN__=${JSON.stringify(sentryEnabled ? 'configured' : '')};</script>`;
    el.append(snippet, { html: true });
  }
}

class JsonLdRewriter {
  private replaced = false;
  constructor(private seo: RouteSeo) {}

  element(el: Element) {
    if (this.replaced) {
      el.remove();
      return;
    }
    const blocks = this.seo.jsonLd
      .map(obj => `<script type="application/ld+json">${serializeJsonLd(obj)}</script>`)
      .join('');
    el.replace(blocks, { html: true });
    this.replaced = true;
  }
}

function lookupSeo(pathname: string): RouteSeo | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/') return null;
  const direct = SEO_INDEX[clean];
  if (direct) return direct;
  return null;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        service: 'panda-desiiignare',
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname.startsWith('/api/')) {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

      if (url.pathname === '/api/oembed' && request.method === 'GET') {
        const target = url.searchParams.get('url') || '';
        const format = (url.searchParams.get('format') || 'json').toLowerCase();
        // Resolve oEmbed targets across four URL shapes:
        //   /<album>                       — album-level (full tracklist embed)
        //   /<album>/<track>               — single track on its canonical page
        //   /embed/<album>                 — direct album embed link
        //   /embed/<album>/<track>         — direct track-in-album embed link
        // Single-segment paths under `/embed/` could be EITHER an album slug
        // (preferred — older share links) OR a bare track slug (legacy). We
        // prefer album first so newly-minted album share cards Just Work, and
        // fall through to track-lookup so historical track-only embeds still
        // resolve.
        let parsed: URL;
        try { parsed = new URL(target); } catch { return jsonResponse({ error: 'invalid_url' }, 400); }
        if (!ALLOWED_HOSTS.has(parsed.host)) return jsonResponse({ error: 'foreign_url' }, 404);
        const embedAlbumTrack = parsed.pathname.match(/^\/embed\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/);
        const embedSingle = parsed.pathname.match(/^\/embed\/([a-z0-9-]{1,80})\/?$/);
        const canonAlbumTrack = parsed.pathname.match(/^\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/);
        const canonAlbum = parsed.pathname.match(/^\/([a-z0-9-]{1,80})\/?$/);

        type Resolved =
          | { kind: 'track'; trackId: string; albumId: string }
          | { kind: 'album'; albumId: string };
        let resolved: Resolved | null = null;
        if (embedAlbumTrack) {
          const [, albumId, trackId] = embedAlbumTrack;
          const track = TRACK_BY_ID.get(trackId);
          if (track && track.album === albumId) resolved = { kind: 'track', trackId, albumId };
        } else if (canonAlbumTrack && !embedSingle) {
          const [, albumId, trackId] = canonAlbumTrack;
          const track = TRACK_BY_ID.get(trackId);
          if (track && track.album === albumId) resolved = { kind: 'track', trackId, albumId };
        } else if (embedSingle) {
          const slug = embedSingle[1];
          if (ALBUM_BY_ID.has(slug)) resolved = { kind: 'album', albumId: slug };
          else if (TRACK_BY_ID.has(slug)) {
            const track = TRACK_BY_ID.get(slug)!;
            resolved = { kind: 'track', trackId: slug, albumId: track.album };
          }
        } else if (canonAlbum) {
          const slug = canonAlbum[1];
          if (ALBUM_BY_ID.has(slug)) resolved = { kind: 'album', albumId: slug };
        }
        if (!resolved) return jsonResponse({ error: 'unknown_target' }, 404);

        // Album embeds render a fuller card (cover + tracklist + transport),
        // so default to a taller iframe unless the consumer asked for tighter.
        const defaultHeight = resolved.kind === 'album' ? 240 : 160;
        const maxwidth = Math.min(Number(url.searchParams.get('maxwidth')) || 480, 1200);
        const maxheight = Math.min(Number(url.searchParams.get('maxheight')) || defaultHeight, 600);

        let embedUrl: string;
        let audioUrl: string;
        let thumbnail: string;
        let oeTitle: string;
        if (resolved.kind === 'track') {
          const track = TRACK_BY_ID.get(resolved.trackId)!;
          embedUrl = `https://music.megabyte.space/embed/${resolved.albumId}/${resolved.trackId}`;
          audioUrl = `https://music.megabyte.space${track.file}`;
          thumbnail = `https://music.megabyte.space/og/track-${resolved.trackId}.jpg`;
          oeTitle = `${track.title} — bZ`;
        } else {
          const album = ALBUM_BY_ID.get(resolved.albumId)!;
          embedUrl = `https://music.megabyte.space/embed/${resolved.albumId}`;
          const firstTrackId = album.trackIds[0];
          const firstTrack = firstTrackId ? TRACK_BY_ID.get(firstTrackId) : null;
          audioUrl = firstTrack ? `https://music.megabyte.space${firstTrack.file}` : '';
          thumbnail = `https://music.megabyte.space${album.cover}`;
          oeTitle = `${album.name} — bZ`;
        }
        const html = `<iframe src="${escapeHtmlAttr(embedUrl)}" width="${maxwidth}" height="${maxheight}" frameborder="0" scrolling="no" allow="autoplay; encrypted-media" allowfullscreen title="${escapeHtmlAttr(oeTitle)}"></iframe>`;
        const payload: Record<string, unknown> = {
          version: '1.0',
          type: 'rich',
          provider_name: 'bZ — music.megabyte.space',
          provider_url: 'https://music.megabyte.space',
          title: oeTitle,
          author_name: 'bZ',
          author_url: 'https://music.megabyte.space',
          html,
          width: maxwidth,
          height: maxheight,
          thumbnail_url: thumbnail,
          thumbnail_width: 1200,
          thumbnail_height: resolved.kind === 'album' ? 1200 : 630,
          cache_age: 86400
        };
        if (audioUrl) payload.audio_url = audioUrl;
        if (format === 'xml') {
          const xml = `<?xml version="1.0" encoding="utf-8"?>\n<oembed>\n${Object.entries(payload).map(([k, v]) => `  <${k}>${escapeXmlText(String(v))}</${k}>`).join('\n')}\n</oembed>`;
          return new Response(xml, {
            status: 200,
            headers: {
              'Content-Type': 'text/xml; charset=utf-8',
              'Cache-Control': 'public, max-age=3600',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      // Health probe — used by uptime checks, deploy verification, and the
      // /api/health route in `wrangler.toml`'s allowlist. Reports KV
      // reachability + worker version + UTC time for log correlation.
      if (url.pathname === '/api/health' || url.pathname === '/health') {
        let kvOk = false;
        try {
          await env.COUNTERS.get('health-probe');
          kvOk = true;
        } catch {
          kvOk = false;
        }
        return jsonResponse(
          {
            status: kvOk ? 'ok' : 'degraded',
            kv: kvOk ? 'ok' : 'fail',
            ai: env.ANTHROPIC_API_KEY ? 'configured' : 'missing',
            push: env.VAPID_PUBLIC_KEY ? 'configured' : 'missing',
            listmonk: env.LISTMONK_API_TOKEN ? 'configured' : 'missing',
            ai_gateway: env.CF_AI_GATEWAY_SLUG || 'direct',
            time: new Date().toISOString()
          },
          kvOk ? 200 : 503,
          { 'Cache-Control': 'no-store' }
        );
      }

      // Client-side error tunnel — observability.ts POSTs here on
      // pageerror + unhandledrejection. Worker forwards the event envelope
      // to Sentry's ingest API so the DSN never leaks to the browser.
      // Rate-limited per IP to prevent log floods from a runaway client.
      if (url.pathname === '/api/error' && request.method === 'POST') {
        if (!env.SENTRY_DSN) return new Response(null, { status: 204 });
        if (await rateLimitedCount(env.COUNTERS, ip, 'err', 'minute', 30, 60)) {
          return new Response(null, { status: 204 });
        }
        try {
          const body = await request.text();
          const parsed = JSON.parse(body) as { message?: string; stack?: string; type?: string; url?: string };
          // Parse DSN: https://<public>@<host>/<project_id>
          const m = env.SENTRY_DSN.match(/^https:\/\/([^@]+)@([^/]+)\/(\d+)$/);
          if (m) {
            const [, key, host, projectId] = m;
            const event = {
              event_id: crypto.randomUUID().replace(/-/g, ''),
              timestamp: Date.now() / 1000,
              platform: 'javascript',
              logger: 'browser',
              level: 'error',
              message: parsed.message?.slice(0, 1000) || 'unknown',
              exception: parsed.stack ? { values: [{ type: parsed.type || 'Error', value: parsed.message?.slice(0, 1000), stacktrace: { frames: [{ filename: parsed.url, function: parsed.stack.split('\n')[0]?.slice(0, 200) }] } }] } : undefined,
              request: { url: parsed.url, headers: { 'User-Agent': request.headers.get('user-agent') || '' } },
              tags: { runtime: 'browser', route: new URL(parsed.url || 'https://x/').pathname }
            };
            ctx.waitUntil(
              fetch(`https://${host}/api/${projectId}/store/`, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=music-megabyte-space/1.0`
                },
                body: JSON.stringify(event)
              }).catch(() => {})
            );
          }
        } catch { /* swallow — never let error reporting throw */ }
        return new Response(null, { status: 204 });
      }

      // Web Vitals sink — observability.ts POSTs LCP/INP/CLS/TTFB once on
      // pagehide via sendBeacon. We aggregate per-route counts in KV with
      // a rolling 1-day window so /api/stats can surface RUM data later.
      if (url.pathname === '/api/vitals' && request.method === 'POST') {
        try {
          const body = await request.text();
          if (body.length < 2048) {
            await env.COUNTERS.put(`vitals:${Date.now()}:${ip.slice(0, 8)}`, body, { expirationTtl: 86400 });
          }
        } catch { /* swallow */ }
        return new Response(null, { status: 204 });
      }

      // Public CSP-report sink. CSP-RO + future enforcing CSP can POST here.
      // Logged via Workers Tracing (auto-spans every fetch), retained 7 days
      // by KV with a per-violation key (hashed). Cheap, non-blocking.
      if (url.pathname === '/api/csp-report' && request.method === 'POST') {
        try {
          const body = await request.text();
          if (body && body.length < 8192) {
            const hash = await sha256Hex(body);
            // 1-day dedup so the same violation only writes once per IP.
            const dedupKey = `csp:${ip}:${hash.slice(0, 16)}`;
            if (!(await env.COUNTERS.get(dedupKey))) {
              await env.COUNTERS.put(`csp-log:${Date.now()}:${hash.slice(0, 8)}`, body, { expirationTtl: 604800 });
              await env.COUNTERS.put(dedupKey, '1', { expirationTtl: 86400 });
            }
          }
        } catch { /* swallow — never fail the CSP report channel */ }
        return new Response(null, { status: 204 });
      }

      if (url.pathname === '/api/stats' && request.method === 'GET') {
        const out: Record<string, { plays: number; shares: number }> = {};
        for (const id of TRACK_BY_ID.keys()) {
          const [p, s] = await Promise.all([readCount(env.COUNTERS, `play:${id}`), readCount(env.COUNTERS, `share:${id}`)]);
          if (p || s) out[id] = { plays: p, shares: s };
        }
        return jsonResponse({ tracks: out });
      }

      const playMatch = url.pathname.match(/^\/api\/play\/([a-z0-9-]{1,80})$/);
      if (playMatch && request.method === 'POST') {
        const id = playMatch[1];
        if (!VALID_TRACK_ID.test(id) || !TRACK_BY_ID.has(id)) return jsonResponse({ error: 'unknown_track' }, 404);
        if (await rateLimited(env.COUNTERS, ip, 'play', id, 1800)) {
          return jsonResponse({ plays: await readCount(env.COUNTERS, `play:${id}`), throttled: true });
        }
        const plays = await bumpCounter(env.COUNTERS, `play:${id}`);
        return jsonResponse({ plays });
      }

      const shareMatch = url.pathname.match(/^\/api\/share\/([a-z0-9-]{1,80})$/);
      if (shareMatch && request.method === 'POST') {
        const id = shareMatch[1];
        if (!VALID_TRACK_ID.test(id) || !TRACK_BY_ID.has(id)) return jsonResponse({ error: 'unknown_track' }, 404);
        if (await rateLimited(env.COUNTERS, ip, 'share', id, 60)) {
          return jsonResponse({ shares: await readCount(env.COUNTERS, `share:${id}`), throttled: true });
        }
        const shares = await bumpCounter(env.COUNTERS, `share:${id}`);
        return jsonResponse({ shares });
      }

      if (url.pathname === '/api/hue/discover' && request.method === 'GET') {
        try {
          const upstream = await fetch('https://discovery.meethue.com/', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'Accept': 'application/json' },
            cf: { cacheTtl: 0 }
          });
          if (!upstream.ok) return jsonResponse({ error: 'discovery_failed', status: upstream.status }, 502);
          const data = await upstream.json();
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': corsOrigin(request)
            }
          });
        } catch (err: unknown) {
          return jsonResponse({ error: 'discovery_error', message: err instanceof Error ? err.message : String(err) }, 502, {}, request);
        }
      }

      if (url.pathname === '/api/subscribe' && request.method === 'POST') {
        let body: { email?: string; pushSubscription?: PushSubscriptionRecord; source?: string };
        try { body = await request.json() as typeof body; } catch { return jsonResponse({ error: 'invalid_json' }, 400); }
        const email = (body.email || '').trim().toLowerCase();
        if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
          return jsonResponse({ error: 'invalid_email' }, 400);
        }
        if (await rateLimited(env.COUNTERS, ip, 'subscribe', 'global', 60)) {
          return jsonResponse({ error: 'throttled' }, 429);
        }
        const emailHash = await sha256Hex(email);
        if (await rateLimited(env.COUNTERS, emailHash, 'subscribe-email', 'global', 120)) {
          return jsonResponse({ error: 'throttled' }, 429);
        }
        const source = (body.source || 'site').toString().slice(0, 64);
        const listmonk = await subscribeToListmonk(env, env.COUNTERS, email, source);
        // Foundation flow #1: auto-fire welcome email on FRESH subscribes only
        // (status='subscribed', not 'already'). Async — never block the
        // /api/subscribe response on a transactional send. Idempotency via
        // KV flag in case Listmonk retries the request.
        if (listmonk.ok && listmonk.status === 'subscribed' && env.LISTMONK_TPL_WELCOME) {
          ctx.waitUntil((async () => {
            const dedupeKey = `fired:welcome:${email}`;
            if (await env.COUNTERS.get(dedupeKey)) return;
            const r = await sendListmonkTransactional(env, env.LISTMONK_TPL_WELCOME, email, { source });
            if (r.ok) {
              await env.COUNTERS.put(dedupeKey, String(Date.now()), { expirationTtl: 365 * 24 * 60 * 60 });
            }
          })());
        }
        let pushResult: 'subscribed' | 'invalid' | 'skipped' = 'skipped';
        const sub = body.pushSubscription;
        if (sub && sub.endpoint && sub.keys?.p256dh && sub.keys?.auth && /^https:\/\//.test(sub.endpoint)) {
          const id = await sha256Hex(sub.endpoint);
          await env.COUNTERS.put(`push:${id}`, JSON.stringify({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
            email,
            subscribedAt: Date.now()
          }), { expirationTtl: 60 * 60 * 24 * 90 });
          pushResult = 'subscribed';
        } else if (sub) {
          pushResult = 'invalid';
        }
        // Persist email→push linkage for cross-channel deduplication.
        await env.COUNTERS.put(`email:${emailHash}`, JSON.stringify({
          email,
          source,
          subscribedAt: Date.now(),
          push: pushResult === 'subscribed'
        }), { expirationTtl: 60 * 60 * 24 * 365 });
        if (!listmonk.ok) {
          return jsonResponse({ error: 'listmonk_failed', detail: listmonk.message, push: pushResult }, 502);
        }
        return jsonResponse({ ok: true, listmonk: listmonk.status, push: pushResult });
      }

      if (url.pathname === '/api/push/vapid-key' && request.method === 'GET') {
        if (!env.VAPID_PUBLIC_KEY) return jsonResponse({ error: 'not_configured' }, 503);
        return jsonResponse({ key: env.VAPID_PUBLIC_KEY }, 200, { 'Cache-Control': 'public, max-age=86400' });
      }

      if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
        let body: PushSubscriptionRecord;
        try { body = await request.json() as PushSubscriptionRecord; } catch { return jsonResponse({ error: 'invalid_json' }, 400); }
        if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) return jsonResponse({ error: 'invalid_subscription' }, 400);
        if (!/^https:\/\//.test(body.endpoint)) return jsonResponse({ error: 'invalid_endpoint' }, 400);
        if (await rateLimited(env.COUNTERS, ip, 'push-sub', 'global', 30)) return jsonResponse({ error: 'throttled' }, 429);
        const id = await sha256Hex(body.endpoint);
        await env.COUNTERS.put(`push:${id}`, JSON.stringify({
          endpoint: body.endpoint,
          keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
          subscribedAt: Date.now()
        }), { expirationTtl: 60 * 60 * 24 * 90 });
        return jsonResponse({ ok: true, id });
      }

      if (url.pathname === '/api/push/unsubscribe' && request.method === 'POST') {
        let body: { endpoint?: string };
        try { body = await request.json() as { endpoint?: string }; } catch { return jsonResponse({ error: 'invalid_json' }, 400); }
        if (!body?.endpoint) return jsonResponse({ error: 'invalid_endpoint' }, 400);
        const id = await sha256Hex(body.endpoint);
        await env.COUNTERS.delete(`push:${id}`);
        return jsonResponse({ ok: true });
      }

      // Manual trigger for the Foundation flow cron — useful for testing
      // OR for backfilling subscribers between cron runs. Auth-gated by
      // PUSH_ADMIN_TOKEN (reusing the same admin secret).
      if (url.pathname === '/api/listmonk/foundation-cron') {
        const auth = request.headers.get('Authorization') || '';
        const queryToken = url.searchParams.get('token') || '';
        if (!env.PUSH_ADMIN_TOKEN || (auth !== `Bearer ${env.PUSH_ADMIN_TOKEN}` && queryToken !== env.PUSH_ADMIN_TOKEN)) {
          return jsonResponse({ error: 'unauthorized' }, 401);
        }
        const result = await runFoundationFlowsCron(env, env.COUNTERS);
        return jsonResponse(result, result.ok ? 200 : 503);
      }

      if (url.pathname === '/api/push/send' && request.method === 'POST') {
        const auth = request.headers.get('Authorization') || '';
        if (!env.PUSH_ADMIN_TOKEN || auth !== `Bearer ${env.PUSH_ADMIN_TOKEN}`) return jsonResponse({ error: 'unauthorized' }, 401);
        if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK || !env.VAPID_SUBJECT) return jsonResponse({ error: 'vapid_not_configured' }, 503);
        let body: { title?: string; body?: string; url?: string; icon?: string; image?: string; tag?: string; trackId?: string };
        try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid_json' }, 400); }
        const payload = JSON.stringify({
          title: body.title || 'bZ — new drop',
          body: body.body || 'Tap to listen.',
          url: body.url || '/',
          icon: body.icon || '/art/icon-192.png',
          image: body.image,
          tag: body.tag || body.trackId || 'bz-broadcast'
        });
        let privateJwk: JsonWebKey;
        try { privateJwk = JSON.parse(env.VAPID_PRIVATE_JWK) as JsonWebKey; } catch { return jsonResponse({ error: 'vapid_jwk_invalid' }, 500); }
        const subs = await listSubscriptions(env.COUNTERS);
        const results = await sendPushBatch(subs, payload, {
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: '',
          privateJwk,
          subject: env.VAPID_SUBJECT
        });
        const expired = results.filter(r => r.expired);
        ctx.waitUntil(Promise.all(expired.map(async r => {
          const id = await sha256Hex(r.endpoint);
          return env.COUNTERS.delete(`push:${id}`);
        })));
        return jsonResponse({
          sent: results.filter(r => r.ok).length,
          failed: results.filter(r => !r.ok && !r.expired).length,
          expired: expired.length,
          total: results.length
        });
      }

      if (url.pathname === '/api/ai/chat' && request.method === 'POST') {
        if (!env.ANTHROPIC_API_KEY) return jsonResponse({ error: 'ai_not_configured' }, 503);
        // Two-tier rate limit: 8/min burst + 60/hr sustained per IP. Protects
        // against runaway loops (free-text AI calls cost real money) while
        // letting normal multi-turn chat flow uninterrupted (~1 turn / 7 sec).
        if (await rateLimitedCount(env.COUNTERS, ip, 'ai-chat', 'minute', 8, 60)) return jsonResponse({ error: 'throttled', retry_in_s: 60 }, 429);
        if (await rateLimitedCount(env.COUNTERS, ip, 'ai-chat', 'hour', 60, 3600)) return jsonResponse({ error: 'throttled_hourly', retry_in_s: 3600 }, 429);
        let body: {
          messages?: { role: 'user' | 'assistant'; content: string }[];
          system?: string;
          model?: string;
          temperature?: number;
          max_tokens?: number;
          stream?: boolean;
        };
        try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid_json' }, 400); }
        const msgs = Array.isArray(body?.messages) ? body.messages.filter(m =>
          (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length > 0
        ) : [];
        if (msgs.length === 0) return jsonResponse({ error: 'no_messages' }, 400);
        const sliced = msgs.slice(-20).map(m => ({ role: m.role, content: m.content.slice(0, 8000) }));
        const model = body.model || env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
        const stream = body.stream !== false;
        const systemText = typeof body.system === 'string'
          ? body.system.slice(0, 4000)
          : "You are bZ's in-app DJ — concise, warm, brand-aware. Speak in the voice of music.megabyte.space: sharp, punchy, Christian-gangster ethic, hustle-gospel, hard but holy. Reference the album Panda Desiiignare and the artist bZ when relevant. Use markdown sparingly. Default to 2-3 sentences unless the user asks for more. Never recommend or mention drugs. Stay reverent around family names.";
        const apiBody = {
          model,
          max_tokens: Math.max(64, Math.min(4096, body.max_tokens || 1024)),
          temperature: Math.max(0, Math.min(1, typeof body.temperature === 'number' ? body.temperature : 0.7)),
          // Prompt caching — the system prompt is ~identical across every
          // turn in a session. Marking it `ephemeral` gives a 5-min reusable
          // cache prefix (0.1× read multiplier vs 1× input cost). Cuts AI
          // bill ~80–90% on chatty sessions. The minimum cacheable prefix
          // for Haiku 4.5 is 4096 tokens — this system prompt is short, so
          // most personas won't hit the threshold alone, but persona +
          // memory + pinned context appended downstream will. Safe to always
          // mark; it's a no-op below the threshold.
          system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
          messages: sliced,
          stream
        };
        try {
          // Route through Cloudflare AI Gateway when configured — gateway
          // logs every call, caches identical hits (no extra cost), enables
          // per-route rate limiting, and gives a fallback hook if Anthropic
          // throws 5xx. Falls back to direct Anthropic when slug is unset.
          const upstreamUrl = env.CF_AI_GATEWAY_SLUG
            ? `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${env.CF_AI_GATEWAY_SLUG}/anthropic/v1/messages`
            : 'https://api.anthropic.com/v1/messages';
          const upstream = await fetch(upstreamUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': env.ANTHROPIC_API_KEY,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify(apiBody)
          });
          if (!upstream.ok) {
            const errText = await upstream.text();
            return jsonResponse({ error: 'upstream_error', status: upstream.status, detail: errText.slice(0, 500) }, 502);
          }
          if (stream && upstream.body) {
            return new Response(upstream.body, {
              status: 200,
              headers: {
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-store',
                'Access-Control-Allow-Origin': corsOrigin(request),
                'X-Accel-Buffering': 'no'
              }
            });
          }
          const data = await upstream.json() as { content?: { type: string; text?: string }[]; usage?: unknown };
          const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('');
          return jsonResponse({ text, usage: data.usage });
        } catch (err) {
          return jsonResponse({ error: 'fetch_failed', detail: (err as Error).message }, 502);
        }
      }

      return jsonResponse({ error: 'not_found' }, 404);
    }

    const isAudio = url.pathname.startsWith('/audio/');
    if (isAudio) {
      // Chromecast / Shaka Player fetch media with CORS mode. Without these
      // headers CAF aborts the load with detailedErrorCode 905 (LOAD_FAILED).
      // Preflight: respond 204 with all the headers a Range-aware audio fetch
      // could possibly need, including a few hours of caching so subsequent
      // segment fetches skip the OPTIONS round-trip entirely.
      const corsHeaders: Record<string, string> = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, If-Range, If-None-Match, If-Modified-Since, Accept, Accept-Encoding, Origin',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Content-Type, Cache-Control',
        'Access-Control-Max-Age': '86400',
        'Timing-Allow-Origin': '*'
      };
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
      const cache = (caches as unknown as { default: Cache }).default;
      const cacheKey = new Request(`${url.origin}${url.pathname}#full`, { method: 'GET' });
      let fullResp = await cache.match(cacheKey);
      if (!fullResp) {
        // Retry transient origin failures up to 6 times with exponential backoff
        // (0, 100, 300, 900, 2700, 8100 ms — total ~12s budget). Cloudflare Assets
        // occasionally returns 503 under cold-start or queue pressure; surfacing
        // that to the audio engine triggers a hard playback abort that can't be
        // recovered from without a user gesture, so absorb here.
        let originResp: Response | null = null;
        let lastStatus = 0;
        for (let attempt = 0; attempt < 6; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 100 * Math.pow(3, attempt - 1)));
          originResp = await env.ASSETS.fetch(new Request(`${url.origin}${url.pathname}`, { method: 'GET' }));
          lastStatus = originResp.status;
          if (originResp.status === 200 && originResp.body) break;
          if (originResp.status === 404) return originResp; // genuine miss — don't retry
        }
        if (!originResp || originResp.status !== 200 || !originResp.body) {
          return new Response(JSON.stringify({ error: 'audio_unavailable', status: lastStatus }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '5', ...corsHeaders }
          });
        }
        const buf = await originResp.arrayBuffer();
        const ct = originResp.headers.get('Content-Type') || 'audio/mpeg';
        const etag = originResp.headers.get('ETag') || '';
        fullResp = new Response(buf, {
          status: 200,
          headers: { 'Content-Type': ct, ...(etag ? { ETag: etag } : {}), 'Cache-Control': 'public, max-age=2592000, immutable' }
        });
        ctx.waitUntil(cache.put(cacheKey, fullResp.clone()));
      }
      const buf = await fullResp.arrayBuffer();
      const total = buf.byteLength;
      const rangeHeader = request.headers.get('Range');
      const audioHeaders = new Headers();
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        // X-Frame-Options: DENY breaks Chromecast Shaka loads via iframe sandbox.
        // Audio is a public, non-credentialed resource — skip frame-blocking here.
        if (k === 'X-Frame-Options') continue;
        audioHeaders.set(k, v);
      }
      for (const [k, v] of Object.entries(corsHeaders)) audioHeaders.set(k, v);
      audioHeaders.set('Content-Type', fullResp.headers.get('Content-Type') || 'audio/mpeg');
      audioHeaders.set('Cache-Control', 'public, max-age=2592000, immutable');
      audioHeaders.set('Accept-Ranges', 'bytes');
      audioHeaders.set('Vary', 'Range');
      const etag = fullResp.headers.get('ETag');
      if (etag) audioHeaders.set('ETag', etag);
      const m = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);
      if (m) {
        const start = m[1] === '' ? Math.max(0, total - Number(m[2])) : Number(m[1]);
        const end = m[1] === '' ? total - 1 : (m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1));
        if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end >= start && end < total) {
          const slice = buf.slice(start, end + 1);
          audioHeaders.set('Content-Range', `bytes ${start}-${end}/${total}`);
          audioHeaders.set('Content-Length', String(slice.byteLength));
          return new Response(slice, { status: 206, statusText: 'Partial Content', headers: audioHeaders });
        }
        audioHeaders.set('Content-Range', `bytes */${total}`);
        return new Response(null, { status: 416, statusText: 'Range Not Satisfiable', headers: audioHeaders });
      }
      audioHeaders.set('Content-Length', String(total));
      return new Response(buf, { status: 200, headers: audioHeaders });
    }

    // Lyrics JSON: edge-cache + retry origin failures. The karaoke renderer
    // hard-fails when this request 503s mid-playback (no fallback in the audio
    // engine), so absorb transient ASSETS faults here.
    if (url.pathname.startsWith('/lyrics/') && url.pathname.endsWith('.json')) {
      const cache = (caches as unknown as { default: Cache }).default;
      const cacheKey = new Request(`${url.origin}${url.pathname}#lyrics`, { method: 'GET' });
      let cached = await cache.match(cacheKey);
      if (!cached) {
        let originResp: Response | null = null;
        let lastStatus = 0;
        for (let attempt = 0; attempt < 6; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 100 * Math.pow(3, attempt - 1)));
          originResp = await env.ASSETS.fetch(new Request(`${url.origin}${url.pathname}`, { method: 'GET' }));
          lastStatus = originResp.status;
          if (originResp.status === 200) break;
          if (originResp.status === 404) return originResp;
        }
        if (!originResp || originResp.status !== 200) {
          return new Response(JSON.stringify({ error: 'lyrics_unavailable', status: lastStatus }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '5' }
          });
        }
        const body = await originResp.arrayBuffer();
        cached = new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=86400, must-revalidate',
            'Access-Control-Allow-Origin': '*'
          }
        });
        ctx.waitUntil(cache.put(cacheKey, cached.clone()));
      }
      return cached;
    }

    const isEmbedRoute = /^\/embed(\/|$)/.test(url.pathname);
    const isAshtonSpaRoute = /^\/ashton\/?$/.test(url.pathname);
    const seoMatch = !isEmbedRoute && !isAshtonSpaRoute ? lookupSeo(url.pathname) : null;
    // Embed routes: fetch /embed.html EXPLICITLY so Workers Assets can't
    // canonicalize via 307 (any redirect strips the album/track segments
    // from location.pathname on the client and the embed boots into the
    // fallback card). The explicit .html path is a static asset, no
    // auto-canonicalization fires.
    const fetchRequest = isEmbedRoute && !url.pathname.endsWith('.html')
      ? new Request(new URL('/embed.html', url.origin), request)
      : isAshtonSpaRoute
      ? new Request(new URL('/', url.origin), request)
      : seoMatch
      ? new Request(new URL('/', url.origin), request)
      : request;

    let response = await env.ASSETS.fetch(fetchRequest);
    // Defensive: if ASSETS still emits a 3xx for embed routes, follow up to
    // 3 redirects server-side so the browser keeps the original
    // /embed/<album>/<track> URL on the client.
    if (isEmbedRoute) {
      let hops = 0;
      while (response.status >= 300 && response.status < 400 && hops < 3) {
        const loc = response.headers.get('Location');
        if (!loc) break;
        response = await env.ASSETS.fetch(new Request(new URL(loc, url.origin), request));
        hops += 1;
      }
    }

    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);

    if (isEmbedRoute) {
      headers.delete('X-Frame-Options');
      headers.set('Content-Security-Policy', "frame-ancestors *");
      headers.set('Cache-Control', 'public, max-age=300, must-revalidate');
    } else if (url.pathname.startsWith('/art/') || url.pathname.startsWith('/og/') || url.pathname.startsWith('/video/')) {
      headers.set('Cache-Control', 'public, max-age=2592000, immutable');
    } else if (url.pathname.endsWith('.html') || url.pathname === '/' || seoMatch) {
      headers.set('Cache-Control', 'public, max-age=300, must-revalidate');
    }

    if (response.headers.get('Content-Type')?.includes('text/html')) {
      // Telemetry config injection — fires for every HTML response so
      // observability.ts has the PostHog key + Sentry endpoint marker even
      // on routes without a seoMatch (404, /share-target, /spotify/callback).
      const telemetry = new TelemetryRewriter(env);
      if (seoMatch) {
        const rewritten = new HTMLRewriter()
          .on('title', new MetaRewriter(seoMatch))
          .on('meta[name="description"]', new MetaRewriter(seoMatch))
          .on('meta[name^="twitter:"]', new MetaRewriter(seoMatch))
          .on('meta[property^="og:"]', new MetaRewriter(seoMatch))
          .on('link[rel="canonical"]', new MetaRewriter(seoMatch))
          .on('link[rel="alternate"][type="application/json+oembed"]', new MetaRewriter(seoMatch))
          .on('link[rel="alternate"][type="text/xml+oembed"]', new MetaRewriter(seoMatch))
          .on('script[type="application/ld+json"]', new JsonLdRewriter(seoMatch))
          .on('body', new SeoBodyRewriter(seoMatch))
          .on('head', telemetry)
          .transform(new Response(response.body, { status: response.status, headers }));
        return rewritten;
      }
      const telemetryOnly = new HTMLRewriter()
        .on('head', telemetry)
        .transform(new Response(response.body, { status: response.status, headers }));
      return telemetryOnly;
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  },

  // Scheduled handler — fires on the cron(s) declared in wrangler.toml
  // [triggers]. Currently: '0 9 * * *' (09:00 UTC daily) for the
  // Foundation flow orchestrator (first-month day-3/10/21 + 90-day winback).
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        const result = await runFoundationFlowsCron(env, env.COUNTERS);
        // Single structured log line — readable in `wrangler tail` + queryable
        // in Workers Tracing once OTel export is wired.
        console.log(JSON.stringify({
          source: 'cron.foundation_flows',
          cron: controller.cron,
          ...result
        }));
      } catch (err) {
        console.error('cron.foundation_flows failed', err instanceof Error ? err.message : err);
      }
    })());
  }
} satisfies ExportedHandler<Env>;
