#!/usr/bin/env node
// Build OG fallback cards by sharp-cropping the relevant cover for each track.
// Reads SEO_INDEX + ALBUMS via dynamic import after esbuild transpile of src/data.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const OG_DIR = path.join(ROOT, 'public/og');
fs.mkdirSync(OG_DIR, { recursive: true });

// Bundle src/data.ts → temp file (no external imports — pure TS)
const tmp = path.join(ROOT, '.tmp-data.mjs');
await build({
  entryPoints: [path.join(ROOT, 'src/data.ts')],
  bundle: false,
  format: 'esm',
  outfile: tmp,
  platform: 'neutral',
  loader: { '.ts': 'ts' },
  logLevel: 'error'
});
// data.ts imports `./types` (only types) — esbuild without bundle drops imports. Patch by removing the type-only import line.
let js = fs.readFileSync(tmp, 'utf8');
js = js.replace(/^import [^;]+;\s*$/gm, '');
fs.writeFileSync(tmp, js);

const data = await import(tmp);
fs.unlinkSync(tmp);

const { ALBUMS, TRACKS, ALBUM_BY_ID } = data;
console.log(`Loaded ${ALBUMS.length} albums, ${TRACKS.length} tracks`);

let made = 0,
  skipped = 0;
for (const track of TRACKS) {
  const out = path.join(OG_DIR, `${track.id}.png`);
  if (fs.existsSync(out)) {
    skipped++;
    continue;
  }
  const album = ALBUM_BY_ID.get(track.album);
  const sourcePath = path.join(ROOT, 'public', track.cover.replace(/^\//, ''));
  const fallback = album ? path.join(ROOT, 'public', album.cover.replace(/^\//, '')) : '';
  const useSrc = fs.existsSync(sourcePath) ? sourcePath : fallback && fs.existsSync(fallback) ? fallback : '';
  if (!useSrc) {
    console.warn(`MISSING for ${track.id}`);
    continue;
  }
  await sharp(useSrc)
    .resize(1200, 630, { fit: 'cover', position: 'center' })
    .png({ quality: 88, compressionLevel: 9 })
    .toFile(out);
  made++;
  console.log(`✓ ${track.id}.png ← ${path.basename(useSrc)}`);
}

// Album OG cards
for (const album of ALBUMS) {
  const out = path.join(OG_DIR, `album-${album.id}.png`);
  if (fs.existsSync(out)) {
    skipped++;
    continue;
  }
  const src = path.join(ROOT, 'public', album.cover.replace(/^\//, ''));
  if (!fs.existsSync(src)) {
    console.warn(`MISSING album cover for ${album.id}`);
    continue;
  }
  await sharp(src)
    .resize(1200, 630, { fit: 'cover', position: 'center' })
    .png({ quality: 88, compressionLevel: 9 })
    .toFile(out);
  made++;
  console.log(`✓ album-${album.id}.png ← ${path.basename(src)}`);
}

console.log(`Done. Made ${made}, skipped ${skipped}.`);
