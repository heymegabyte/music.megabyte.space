#!/usr/bin/env node
// Generate unique 1200x630 OG share cards via gpt-image-1, one per track.
// Reads lyrics/vibe/wisdom from src/data.ts via esbuild transpile.
// Outputs PNG to public/og/<track-id>.png (overwrites album-cover fallback).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const OG_DIR = path.join(ROOT, 'public/og');
const MARKER_DIR = path.join(ROOT, '.og-markers');
const LOG_FILE = path.join(ROOT, '.og-dalle.log');
fs.mkdirSync(OG_DIR, { recursive: true });
fs.mkdirSync(MARKER_DIR, { recursive: true });

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY missing');
  process.exit(1);
}

const log = msg => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stdout.write(line);
};

const tmp = path.join(ROOT, '.tmp-dalle-data.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src/data.ts')],
  bundle: false,
  format: 'esm',
  outfile: tmp,
  platform: 'neutral',
  loader: { '.ts': 'ts' },
  logLevel: 'error'
});
let js = fs.readFileSync(tmp, 'utf8').replace(/^import [^;]+;\s*$/gm, '');
fs.writeFileSync(tmp, js);
const { TRACKS, ALBUM_BY_ID } = await import(tmp);
fs.unlinkSync(tmp);

const STYLE = `Cinematic editorial album-art photograph, dark mood, painterly atmosphere. Color palette: deep midnight blue (#060610), electric cyan (#00E5FF), glowing violet (#7C3AED), gold ember accent. Wide 1.91:1 horizontal composition, full bleed, no borders. Strong negative space top and bottom for safe-area cropping. No people's faces, no celebrities, no real-person likeness, no logos, no album-cover lettering, no watermarks, no text. Anti-AI-slop: tactile texture, real photographic grain, restrained mystical sci-fi atmosphere.`;

function sceneFor(track, album) {
  const firstLine = (track.lyrics?.[0] || '').slice(0, 200);
  const vibe = track.vibe || '';
  const albumTone = album?.tagline || '';
  return `A scene inspired by these lyrics — "${firstLine}" — vibe: "${vibe}". Album tone: "${albumTone}". Symbolic, atmospheric, no literal faces. Composition: hero subject in lower-left third, moody empty sky/space upper-right. Holy + gritty, hard but holy.`;
}

async function generate(track) {
  const album = ALBUM_BY_ID.get(track.album);
  const out = path.join(OG_DIR, `${track.id}.png`);
  // Skip if a non-fallback image is already there. Use marker file to know.
  const marker = path.join(MARKER_DIR, `${track.id}.dalle`);
  if (fs.existsSync(marker)) {
    log(`skip ${track.id} (already DALL-E generated)`);
    return;
  }

  const prompt = `${STYLE}\n\n${sceneFor(track, album)}`;
  const resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size: '1536x1024',
      quality: 'medium'
    })
  });

  if (!resp.ok) {
    log(`FAIL ${track.id}: HTTP ${resp.status} ${(await resp.text()).slice(0, 300)}`);
    return;
  }
  const j = await resp.json();
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) {
    log(`FAIL ${track.id}: no b64 in response`);
    return;
  }
  const png = Buffer.from(b64, 'base64');
  await sharp(png)
    .resize(1200, 630, { fit: 'cover', position: 'center' })
    .png({ quality: 90, compressionLevel: 9 })
    .toFile(out);
  fs.writeFileSync(marker, new Date().toISOString());
  log(`✓ ${track.id} (${(fs.statSync(out).size / 1024).toFixed(0)}KB)`);
}

log(`Starting DALL-E run for ${TRACKS.length} tracks`);
for (const track of TRACKS) {
  try {
    await generate(track);
  } catch (err) {
    log(`ERR ${track.id}: ${err?.message || err}`);
  }
}
log('All done.');
