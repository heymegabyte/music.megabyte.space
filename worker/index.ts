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
  ANTHROPIC_API_KEY?: string; // For /api/ai/chat — Claude Haiku 4.5 streaming
  ANTHROPIC_MODEL?: string;   // Override default model (claude-haiku-4-5-20251001)
}

const VALID_TRACK_ID = /^[a-z0-9-]{1,80}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'https://music.megabyte.space',
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
  'X-Frame-Options': 'DENY'
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
        if (parsed.host !== 'music.megabyte.space') return jsonResponse({ error: 'foreign_url' }, 404);
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
              'Access-Control-Allow-Origin': 'https://music.megabyte.space'
            }
          });
        } catch (err: unknown) {
          return jsonResponse({ error: 'discovery_error', message: err instanceof Error ? err.message : String(err) }, 502);
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
        if (await rateLimited(env.COUNTERS, ip, 'ai-chat', 'global', 6)) return jsonResponse({ error: 'throttled', retry_in_s: 6 }, 429);
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
        const apiBody = {
          model,
          max_tokens: Math.max(64, Math.min(4096, body.max_tokens || 1024)),
          temperature: Math.max(0, Math.min(1, typeof body.temperature === 'number' ? body.temperature : 0.7)),
          system: typeof body.system === 'string'
            ? body.system.slice(0, 4000)
            : "You are bZ's in-app DJ — concise, warm, brand-aware. Speak in the voice of music.megabyte.space: sharp, punchy, Christian-gangster ethic, hustle-gospel, hard but holy. Reference the album Panda Desiiignare and the artist bZ when relevant. Use markdown sparingly. Default to 2-3 sentences unless the user asks for more. Never recommend or mention drugs. Stay reverent around family names.",
          messages: sliced,
          stream
        };
        try {
          const upstream = await fetch('https://api.anthropic.com/v1/messages', {
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
                'Access-Control-Allow-Origin': 'https://music.megabyte.space',
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
        // Retry transient origin failures up to 3 times with exponential backoff (75ms→225ms→675ms).
        // Cloudflare Assets occasionally returns 503 under cold-start or queue pressure;
        // surfacing that to the audio engine triggers a hard playback abort.
        let originResp: Response | null = null;
        let lastStatus = 0;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 75 * Math.pow(3, attempt - 1)));
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
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 75 * Math.pow(3, attempt - 1)));
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

    if (seoMatch && response.headers.get('Content-Type')?.includes('text/html')) {
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
        .transform(new Response(response.body, { status: response.status, headers }));
      return rewritten;
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
} satisfies ExportedHandler<Env>;
