#!/usr/bin/env node
// Composite per-track 1200×630 og-images from existing cover art + branded overlay.
// Free, instant, regenerable. Reads track list straight from src/data.ts via dynamic import + light parser.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'public/og');
await mkdir(OUT, { recursive: true });

// Lightweight parse of data.ts — extract via regex (we control the file shape).
const dataSrc = await readFile(resolve(ROOT, 'src/data.ts'), 'utf8');
function extractList(label) {
  const re = new RegExp(`export const ${label}.*?=\\s*\\[([\\s\\S]*?)\\n\\];`);
  const m = dataSrc.match(re);
  if (!m) throw new Error(`could not extract ${label}`);
  return m[1];
}
function extractObject(label) {
  const re = new RegExp(`const ${label}\\s*=\\s*\\{([\\s\\S]*?)\\n\\};`);
  const m = dataSrc.match(re);
  if (!m) throw new Error(`could not extract ${label}`);
  const out = {};
  for (const line of m[1].split('\n')) {
    const lm = line.match(/^\s*(\w+)\s*:\s*['"`]([^'"`]+)['"`]/);
    if (lm) out[lm[1]] = lm[2];
  }
  return out;
}
function objects(block) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < block.length; i++) {
    const c = block[i];
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) out.push(block.slice(start, i + 1));
    }
  }
  return out;
}
function field(blob, name) {
  const reStr = new RegExp(`${name}:\\s*['"\`]([^'"\`]+)['"\`]`);
  const m = blob.match(reStr);
  if (m) return m[1];
  const reRef = new RegExp(`${name}:\\s*COVERS\\.(\\w+)`);
  const r = blob.match(reRef);
  if (r) return { __covers: r[1] };
  return null;
}

const COVERS = extractObject('COVERS');
function resolveCover(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v.__covers) return COVERS[v.__covers] || null;
  return null;
}

const albumBlobs = objects(extractList('ALBUMS'));
const ALBUMS = albumBlobs.map(b => ({
  id: field(b, 'id'),
  name: field(b, 'name'),
  cover: resolveCover(field(b, 'cover')),
  accent: field(b, 'accent'),
  tagline: field(b, 'tagline')
}));
const ALBUM_BY_ID = new Map(ALBUMS.map(a => [a.id, a]));

const trackBlobs = objects(extractList('TRACKS'));
const TRACKS = trackBlobs.map(b => ({
  id: field(b, 'id'),
  title: field(b, 'title'),
  cover: resolveCover(field(b, 'cover')),
  album: field(b, 'album'),
  vibe: field(b, 'vibe')
}));

console.log(`Parsed ${ALBUMS.length} albums, ${TRACKS.length} tracks.`);

// SVG overlay: gradient scrim + title + album + vibe + brand mark.
function svgOverlay({ title, albumName, vibe, accent }) {
  const safeTitle = String(title)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;');
  const safeAlbum = String(albumName)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;');
  const safeVibe = String(vibe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;');
  const titleSize = title.length > 22 ? 64 : title.length > 16 ? 76 : 92;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#060610" stop-opacity="0.95"/>
      <stop offset="0.55" stop-color="#060610" stop-opacity="0.78"/>
      <stop offset="1" stop-color="#060610" stop-opacity="0.20"/>
    </linearGradient>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#060610" stop-opacity="0"/>
      <stop offset="1" stop-color="#060610" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="accentBar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${accent}"/>
      <stop offset="1" stop-color="#7C3AED"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="1200" height="630" fill="url(#scrim)"/>
  <rect x="0" y="0" width="1200" height="630" fill="url(#bottomFade)"/>
  <rect x="60" y="60" width="6" height="38" fill="url(#accentBar)" rx="3"/>
  <text x="84" y="90" font-family="JetBrains Mono, ui-monospace, monospace" font-size="22" font-weight="600" fill="${accent}" letter-spacing="4">${safeAlbum.toUpperCase()}</text>
  <text x="60" y="${330}" font-family="Sora, system-ui, sans-serif" font-size="${titleSize}" font-weight="800" fill="#f4f4ff" letter-spacing="-1">${safeTitle}</text>
  <text x="60" y="${380}" font-family="Space Grotesk, system-ui, sans-serif" font-size="28" font-weight="400" fill="rgba(244,244,255,0.78)" font-style="italic">${safeVibe}</text>
  <rect x="60" y="540" width="48" height="32" fill="${accent}" rx="2" transform="skewX(-8)"/>
  <text x="120" y="565" font-family="Sora, system-ui, sans-serif" font-size="26" font-weight="700" fill="#f4f4ff">Panda Desiiignare</text>
  <text x="120" y="588" font-family="JetBrains Mono, monospace" font-size="14" font-weight="600" fill="rgba(244,244,255,0.5)" letter-spacing="3">BY  BZ  ·  MUSIC.MEGABYTE.SPACE</text>
</svg>`;
}

async function buildCard(track) {
  const album = ALBUM_BY_ID.get(track.album);
  if (!album) {
    console.error(`[${track.id}] no album for ${track.album}`);
    return false;
  }
  const accent = album.accent || '#00E5FF';
  const coverPath = resolve(ROOT, 'public', track.cover.replace(/^\//, ''));
  const t0 = Date.now();

  // Cover-fill 1200×630 with the cover art (covers extend to right side, scrim handles left).
  const base = sharp(coverPath).resize(1200, 630, { fit: 'cover', position: 'center' });
  const overlay = Buffer.from(
    svgOverlay({
      title: track.title,
      albumName: album.name,
      vibe: track.vibe || '',
      accent
    })
  );
  const composed = await base
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();

  const file = resolve(OUT, `${track.id}.jpg`);
  await writeFile(file, composed);
  console.log(`[${track.id}] ${(composed.length / 1024).toFixed(1)}KB in ${Date.now() - t0}ms`);
  return true;
}

async function buildAlbumCard(album) {
  const accent = album.accent || '#00E5FF';
  const coverPath = resolve(ROOT, 'public', album.cover.replace(/^\//, ''));
  const t0 = Date.now();
  const base = sharp(coverPath).resize(1200, 630, { fit: 'cover', position: 'center' });
  const overlay = Buffer.from(
    svgOverlay({
      title: album.name,
      albumName: 'ALBUM',
      vibe: album.tagline || '',
      accent
    })
  );
  const composed = await base
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  const file = resolve(OUT, `album-${album.id}.jpg`);
  await writeFile(file, composed);
  console.log(`[album-${album.id}] ${(composed.length / 1024).toFixed(1)}KB in ${Date.now() - t0}ms`);
  return true;
}

const trackResults = await Promise.all(TRACKS.map(buildCard));
const albumResults = await Promise.all(ALBUMS.map(buildAlbumCard));
const tOk = trackResults.filter(Boolean).length;
const aOk = albumResults.filter(Boolean).length;
console.log(`\nDone: ${tOk}/${TRACKS.length} track cards, ${aOk}/${ALBUMS.length} album cards.`);
process.exit(tOk === TRACKS.length && aOk === ALBUMS.length ? 0 : 1);
