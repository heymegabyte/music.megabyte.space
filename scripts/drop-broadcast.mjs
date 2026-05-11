#!/usr/bin/env node
// Listmonk campaign + optional Web Push for a new track drop.
//
//   node scripts/drop-broadcast.mjs <track-id> [--dry] [--push] [--from "bZ <hi@megabyte.space>"]
//
// Env: LISTMONK_URL, LISTMONK_API_USER, LISTMONK_API_TOKEN, [LISTMONK_LIST_NAME],
//      [LISTMONK_FROM_EMAIL], [PUSH_ADMIN_URL], [PUSH_ADMIN_TOKEN]
//
// Reads src/data.ts via tsc-free dynamic import (uses pre-built dist if present, else parses raw).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SITE_ORIGIN = 'https://music.megabyte.space';
const DEFAULT_LIST_NAME = 'music.megabyte.space';
const DEFAULT_FROM = process.env.LISTMONK_FROM_EMAIL || 'bZ <hi@megabyte.space>';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));
const trackId = positional[0];
const fromOverride = (() => {
  const i = args.indexOf('--from');
  return i > -1 ? args[i + 1] : null;
})();

if (!trackId || flags.has('--help')) {
  console.log('Usage: node scripts/drop-broadcast.mjs <track-id> [--dry] [--push] [--from "Name <email>"]');
  process.exit(trackId ? 0 : 1);
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing env: ${name}`); process.exit(1); }
  return v;
}

const LISTMONK_URL = (requireEnv('LISTMONK_URL')).replace(/\/+$/, '');
const LISTMONK_API_USER = requireEnv('LISTMONK_API_USER');
const LISTMONK_API_TOKEN = requireEnv('LISTMONK_API_TOKEN');
const LISTMONK_LIST_NAME = process.env.LISTMONK_LIST_NAME || DEFAULT_LIST_NAME;

function lmHeaders() {
  return {
    Authorization: `token ${LISTMONK_API_USER}:${LISTMONK_API_TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'music.megabyte.space/drop-broadcast'
  };
}

async function lmFetch(path, init = {}) {
  const r = await fetch(`${LISTMONK_URL}${path}`, { ...init, headers: { ...lmHeaders(), ...(init.headers || {}) } });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!r.ok) throw new Error(`Listmonk ${r.status} ${path}: ${text.slice(0, 300)}`);
  return json;
}

// Tiny .ts loader — extract ALBUMS + TRACKS const-literal blocks and eval as JS.
async function loadTracks() {
  const src = await readFile(resolve(ROOT, 'src/data.ts'), 'utf8');
  const grab = (name) => {
    const re = new RegExp(`export const ${name}\\s*:\\s*[A-Za-z\\[\\]]+\\s*=\\s*(\\[[\\s\\S]*?\\n\\]);`);
    const m = src.match(re);
    if (!m) throw new Error(`Could not extract ${name} from data.ts`);
    return m[1];
  };
  // Parse top-level COVERS map separately (used inside TRACKS).
  const coversMatch = src.match(/const COVERS\s*=\s*(\{[\s\S]*?\n\});/);
  if (!coversMatch) throw new Error('Could not extract COVERS from data.ts');
  const js = `const COVERS = ${coversMatch[1]};\nexport const ALBUMS = ${grab('ALBUMS')};\nexport const TRACKS = ${grab('TRACKS')};`;
  const dataUrl = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  const mod = await import(dataUrl);
  return { tracks: mod.TRACKS, albums: mod.ALBUMS };
}

const { tracks, albums } = await loadTracks();
const track = tracks.find(t => t.id === trackId);
if (!track) {
  console.error(`Unknown track: ${trackId}`);
  console.error('Available:', tracks.map(t => t.id).join(', '));
  process.exit(1);
}
const album = albums.find(a => a.id === track.album);
const trackUrl = `${SITE_ORIGIN}/${track.album}/${track.id}`;
const ogImage = `${SITE_ORIGIN}/og/${track.id}.png`;

// Resolve the drop list (matches the worker's logic).
async function resolveListId() {
  const search = await lmFetch(`/api/lists?query=${encodeURIComponent(LISTMONK_LIST_NAME)}&per_page=100`);
  const results = search?.data?.results || [];
  const match = results.find(l => l.name === LISTMONK_LIST_NAME) || results[0];
  if (match?.id) return match.id;
  throw new Error(`Listmonk list not found: ${LISTMONK_LIST_NAME}`);
}

const subject = `${track.title} — new drop · bZ`;
const previewText = track.vibe.charAt(0).toUpperCase() + track.vibe.slice(1);
const html = `<!doctype html><html><body style="margin:0;padding:0;background:#060610;color:#eef2ff;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif">
<div style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${previewText}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#060610;padding:32px 16px">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">
      <tr><td style="padding-bottom:24px">
        <p style="margin:0;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#7C3AED">bZ · drops</p>
        <h1 style="margin:8px 0 0;font-size:28px;line-height:1.15;color:#eef2ff;font-weight:800">${track.title}</h1>
        <p style="margin:6px 0 0;font-size:14px;color:#9aa3b2">${album?.name || 'bZ'} · ${previewText}</p>
      </td></tr>
      <tr><td>
        <a href="${trackUrl}" style="display:block;text-decoration:none">
          <img src="${ogImage}" alt="${track.title}" width="560" height="294" style="display:block;width:100%;height:auto;border:0;border-radius:14px"/>
        </a>
      </td></tr>
      <tr><td style="padding:24px 0 0">
        <a href="${trackUrl}" style="display:inline-block;background:#00E5FF;color:#060610;text-decoration:none;font-weight:700;letter-spacing:.04em;padding:14px 22px;border-radius:999px">▶  Press play</a>
      </td></tr>
      <tr><td style="padding:28px 0 0;font-size:13px;line-height:1.55;color:#c8d0db">
        ${track.lyrics.slice(0, 4).map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).map(l => `<p style="margin:0 0 6px">${l}</p>`).join('')}
      </td></tr>
      <tr><td style="padding:32px 0 8px;font-size:12px;color:#6b7280;border-top:1px solid #1a1a2e;margin-top:24px">
        <p style="margin:16px 0 4px">First listen, every drop. No ads. No spam.</p>
        <p style="margin:0">
          <a href="${SITE_ORIGIN}" style="color:#50AAE3;text-decoration:none">music.megabyte.space</a>
          &nbsp;·&nbsp;
          <a href="{{ UnsubscribeURL }}" style="color:#9aa3b2;text-decoration:underline">unsubscribe</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

const listId = await resolveListId();
console.log(`✓ Listmonk list "${LISTMONK_LIST_NAME}" id=${listId}`);
console.log(`  Track: ${track.title} (${track.id}) — ${trackUrl}`);

if (flags.has('--dry')) {
  console.log('--- DRY RUN ---');
  console.log(`Subject: ${subject}`);
  console.log(`From:    ${fromOverride || DEFAULT_FROM}`);
  console.log(`HTML:    ${html.length} bytes`);
  console.log(`OG:      ${ogImage}`);
  if (flags.has('--push')) console.log('Push:    would POST /api/push/send');
  process.exit(0);
}

const created = await lmFetch('/api/campaigns', {
  method: 'POST',
  body: JSON.stringify({
    name: `drop:${track.id}:${new Date().toISOString().slice(0, 10)}`,
    subject,
    lists: [listId],
    from_email: fromOverride || DEFAULT_FROM,
    content_type: 'html',
    body: html,
    type: 'regular',
    tags: ['drop', track.album, track.id],
    altbody: `${track.title} — ${album?.name || 'bZ'}\nListen: ${trackUrl}\n\nUnsubscribe: {{ UnsubscribeURL }}`
  })
});
const campaignId = created?.data?.id;
if (!campaignId) throw new Error('Campaign create returned no id');
console.log(`✓ Campaign #${campaignId} created.`);

await lmFetch(`/api/campaigns/${campaignId}/status`, {
  method: 'PUT',
  body: JSON.stringify({ status: 'running' })
});
console.log(`✓ Campaign #${campaignId} sending. Watch ${LISTMONK_URL}/admin/campaigns/${campaignId}`);

if (flags.has('--push')) {
  const pushUrl = process.env.PUSH_ADMIN_URL || `${SITE_ORIGIN}/api/push/send`;
  const pushTok = process.env.PUSH_ADMIN_TOKEN;
  if (!pushTok) {
    console.warn('! --push set but PUSH_ADMIN_TOKEN missing — skipping push');
  } else {
    const r = await fetch(pushUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pushTok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `${track.title} — bZ`,
        body: previewText,
        url: trackUrl,
        image: ogImage,
        tag: `drop:${track.id}`,
        trackId: track.id
      })
    });
    const text = await r.text();
    console.log(`✓ Push fan-out: ${r.status} ${text.slice(0, 200)}`);
  }
}
