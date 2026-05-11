#!/usr/bin/env node
// Generate per-track 1200×630 OG share cards.
//
// Composites the track cover (left square) + branded title overlay (right
// gradient panel) on a blurred-cover background. JPEG output, ~60–90 KB each.
//
// Idempotent: skips a card if dest mtime > both data.ts mtime and cover mtime.
// Triggered by `npm run prebuild`; safe to run standalone (`node scripts/gen-og-cards.mjs`).
//
// Album fallback uses the album cover when track.cover unresolved.

import { promises as fs } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_PATH = path.join(ROOT, 'src/data.ts');
const PUBLIC_DIR = path.join(ROOT, 'public');
const OG_DIR = path.join(PUBLIC_DIR, 'og');
const BRAND_MARK = path.join(PUBLIC_DIR, 'art/bz-mark.png');

const WIDTH = 1200;
const HEIGHT = 630;
const COVER_SIZE = 510;  // square art on the left
const COVER_X = 60;
const COVER_Y = (HEIGHT - COVER_SIZE) / 2;

const dataSrc = await fs.readFile(DATA_PATH, 'utf-8');
const dataMtime = statSync(DATA_PATH).mtimeMs;

// Parse COVERS map → { c2: '/art/chatgpt-2.png', ... }
const coversMatch = dataSrc.match(/const COVERS\s*=\s*\{([^}]+)\}/);
if (!coversMatch) throw new Error('COVERS map not found in data.ts');
const COVERS = Object.fromEntries(
  [...coversMatch[1].matchAll(/(\w+):\s*'([^']+)'/g)].map(m => [m[1], m[2]])
);

// Parse ALBUMS → { id → { name, cover, accent } }
const ALBUMS = {};
const albumBlockMatch = dataSrc.match(/export const ALBUMS:[^=]*=\s*\[([\s\S]*?)\n\];/);
if (albumBlockMatch) {
  const albumBlock = albumBlockMatch[1];
  const albumEntries = [...albumBlock.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*cover:\s*'([^']+)',[\s\S]*?accent:\s*'([^']+)'/g)];
  for (const [, id, name, cover, accent] of albumEntries) {
    ALBUMS[id] = { id, name, cover, accent };
  }
}

// Parse TRACKS — each entry: { id, title, artist, cover, album }
const trackBlockMatch = dataSrc.match(/export const TRACKS:[^=]*=\s*\[([\s\S]+)\n\];/);
if (!trackBlockMatch) throw new Error('TRACKS array not found in data.ts');

const TRACKS = [];
const trackRegex = /\{\s*id:\s*'([^']+)',\s*title:\s*['"]([^'"]+)['"],\s*artist:\s*'([^']+)',\s*file:\s*'[^']+',\s*cover:\s*([^,]+),\s*album:\s*'([^']+)'/g;
for (const m of dataSrc.matchAll(trackRegex)) {
  const [, id, title, artist, coverRef, album] = m;
  const cover = coverRef.startsWith("'") ? coverRef.replace(/'/g, '') :
    (COVERS[coverRef.replace(/^COVERS\./, '').trim()] || ALBUMS[album]?.cover || '/art/cover-panda-desiiignare.png');
  TRACKS.push({ id, title: title.replace(/&apos;|&#39;/g, "'").replace(/&quot;/g, '"'), artist, cover, album });
}

if (TRACKS.length === 0) throw new Error('No tracks parsed from data.ts');

await fs.mkdir(OG_DIR, { recursive: true });

// Escape XML/SVG text content
function svgEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Wrap a title and auto-fit font size to a fixed panel width.
// Panel inner width = 500px. Sora 900 average glyph width ≈ 0.56× fontSize.
const PANEL_INNER_W = 500;
const GLYPH_RATIO = 0.56;

function wrapTitle(title, maxLines = 3) {
  const words = title.split(/\s+/);

  // Try each candidate line count, pick the one with the largest fitting font.
  // For each line count, distribute words greedily by char balance.
  let best = null;
  for (let n = 1; n <= maxLines; n++) {
    if (n > words.length) break;
    const lines = greedyBalance(words, n);
    const longest = Math.max(...lines.map(l => l.length));
    // fontSize such that longest line fits in PANEL_INNER_W
    const fontSize = Math.min(
      n === 1 ? 112 : n === 2 ? 92 : 74,
      Math.floor(PANEL_INNER_W / (longest * GLYPH_RATIO))
    );
    const score = fontSize - n * 4; // prefer larger fonts, slight penalty per extra line
    if (!best || score > best.score) best = { lines, fontSize, score };
  }
  if (!best) return { lines: [title], fontSize: 64 };
  return best;
}

function greedyBalance(words, lineCount) {
  // Simple greedy: distribute words across `lineCount` lines aiming for
  // similar total char counts per line.
  const total = words.join(' ').length;
  const target = total / lineCount;
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (lines.length >= lineCount - 1) {
      cur = cur ? `${cur} ${w}` : w;
      continue;
    }
    const candidate = cur ? `${cur} ${w}` : w;
    if (cur && Math.abs(candidate.length - target) > Math.abs(cur.length - target)) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildOverlaySvg(track, album) {
  const title = svgEscape(track.title);
  const eyebrow = svgEscape(`${track.artist.toUpperCase()} · ${album?.name?.toUpperCase() ?? ''}`.replace(/ · $/, ''));
  const accent = album?.accent ?? '#00E5FF';
  const { lines: titleLines, fontSize } = wrapTitle(title);
  const lineHeight = Math.round(fontSize * 0.96);
  const titleStartY = HEIGHT / 2 + 18 - ((titleLines.length - 1) * lineHeight) / 2;

  // Right text panel x range: 620 → 1140 (520px wide)
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#06030f" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#06030f" stop-opacity="0.92"/>
    </linearGradient>
    <linearGradient id="title" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%"   stop-color="#FFFFFF"/>
      <stop offset="60%"  stop-color="${accent}"/>
      <stop offset="100%" stop-color="#FF2DA0"/>
    </linearGradient>
    <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="${accent}"/>
      <stop offset="100%" stop-color="#FF2DA0"/>
    </linearGradient>
    <style>
      .eyebrow {
        font-family: 'Sora','SF Pro Display','Helvetica Neue',Arial,sans-serif;
        font-weight: 700;
        font-size: 22px;
        letter-spacing: 6px;
        fill: ${accent};
      }
      .titletext {
        font-family: 'Sora','SF Pro Display','Helvetica Neue',Arial,sans-serif;
        font-weight: 900;
        font-size: ${fontSize}px;
        letter-spacing: -1.2px;
        fill: url(#title);
      }
      .footer {
        font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace;
        font-weight: 500;
        font-size: 22px;
        letter-spacing: 2px;
        fill: rgba(255,255,255,0.7);
      }
      .footer-domain {
        font-family: 'JetBrains Mono','SF Mono',ui-monospace,monospace;
        font-weight: 600;
        font-size: 22px;
        letter-spacing: 1px;
        fill: #FFFFFF;
      }
    </style>
  </defs>

  <!-- right panel scrim for legibility -->
  <rect x="600" y="0" width="600" height="${HEIGHT}" fill="url(#panel)"/>

  <!-- accent rail along right edge -->
  <rect x="1180" y="40" width="6" height="${HEIGHT - 80}" fill="url(#rail)" rx="3"/>

  <!-- eyebrow -->
  <text x="630" y="160" class="eyebrow">${eyebrow}</text>

  <!-- multi-line title -->
  ${titleLines.map((line, i) =>
    `<text x="630" y="${titleStartY + i * lineHeight}" class="titletext">${line}</text>`
  ).join('\n  ')}

  <!-- footer: domain -->
  <text x="630" y="${HEIGHT - 62}" class="footer">PLAY ON  </text>
  <text x="755" y="${HEIGHT - 62}" class="footer-domain">music.megabyte.space</text>
</svg>`;
}

const brandMarkBuf = existsSync(BRAND_MARK) ? await fs.readFile(BRAND_MARK) : null;

async function generateCard(track) {
  const album = ALBUMS[track.album];
  const outPath = path.join(OG_DIR, `track-${track.id}.jpg`);
  const coverPath = path.join(PUBLIC_DIR, track.cover.replace(/^\//, ''));

  if (!existsSync(coverPath)) {
    console.warn(`  ! missing cover ${track.cover} for ${track.id} — skip`);
    return { skipped: true, reason: 'missing-cover' };
  }

  // Idempotency: skip if dest is newer than both inputs + script
  if (existsSync(outPath)) {
    const destMtime = statSync(outPath).mtimeMs;
    const coverMtime = statSync(coverPath).mtimeMs;
    const scriptMtime = statSync(fileURLToPath(import.meta.url)).mtimeMs;
    if (destMtime > dataMtime && destMtime > coverMtime && destMtime > scriptMtime) {
      return { skipped: true, reason: 'up-to-date' };
    }
  }

  // 1. Blurred + darkened background from cover, full-bleed
  const bg = await sharp(coverPath)
    .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
    .blur(28)
    .modulate({ brightness: 0.42, saturation: 1.35 })
    .toBuffer();

  // 2. Cover art — sharp square, soft shadow handled by SVG drop-shadow on a wrapper later
  const coverSquare = await sharp(coverPath)
    .resize(COVER_SIZE, COVER_SIZE, { fit: 'cover', position: 'centre' })
    .composite([{
      input: Buffer.from(`<svg width="${COVER_SIZE}" height="${COVER_SIZE}"><rect width="${COVER_SIZE}" height="${COVER_SIZE}" rx="22" ry="22" fill="white"/></svg>`),
      blend: 'dest-in'
    }])
    .png()
    .toBuffer();

  const overlaySvg = Buffer.from(buildOverlaySvg(track, album));

  const composites = [
    { input: coverSquare, top: COVER_Y, left: COVER_X },
    { input: overlaySvg, top: 0, left: 0 }
  ];

  // Brand mark in top-right (subtle, opacity 0.85)
  if (brandMarkBuf) {
    const mark = await sharp(brandMarkBuf)
      .resize(64, 64, { fit: 'contain' })
      .ensureAlpha()
      .modulate({ brightness: 1, saturation: 1 })
      .composite([{
        input: Buffer.from('<svg><rect width="64" height="64" fill="rgba(255,255,255,0.85)"/></svg>'),
        blend: 'dest-in'
      }])
      .toBuffer();
    composites.push({ input: mark, top: 50, left: WIDTH - 64 - 80 });
  }

  await sharp(bg)
    .composite(composites)
    .jpeg({ quality: 82, progressive: true, mozjpeg: true, chromaSubsampling: '4:2:0' })
    .toFile(outPath);

  const size = (await fs.stat(outPath)).size;
  return { size, ok: true };
}

const t0 = Date.now();
let generated = 0, skipped = 0, missing = 0, totalBytes = 0;
const results = [];

for (const track of TRACKS) {
  const r = await generateCard(track);
  if (r.skipped) {
    if (r.reason === 'missing-cover') missing++;
    else skipped++;
  } else {
    generated++;
    totalBytes += r.size;
    results.push({ id: track.id, size: r.size });
  }
}

const ms = Date.now() - t0;
console.log(`OG cards: generated ${generated}, skipped ${skipped}${missing ? `, missing ${missing}` : ''}, ${(totalBytes / 1024).toFixed(0)} KB total in ${ms}ms`);
if (generated > 0) {
  const avgKB = totalBytes / generated / 1024;
  console.log(`  avg ${avgKB.toFixed(1)} KB/card · ${TRACKS.length} tracks total`);
}
