#!/usr/bin/env node
// Per-track curated-lyric alignment.
// Reads src/data.ts → for each track, runs ffprobe on /public/${file} to get duration,
// distributes the 4 curated lines weighted by syllable count across the vocal window
// (intro pad + outro pad), writes public/lyrics/${id}.json with the existing schema:
//   { lines: [{ s, e, text }], duration, source: 'aligned' }

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const exec = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '..');
const AUDIO_PUBLIC = resolve(ROOT, 'public');
const LYRICS_DIR = resolve(ROOT, 'public/lyrics');
const DATA_TS = resolve(ROOT, 'src/data.ts');

const INTRO_PAD = 14;
const OUTRO_PAD = 10;
const MIN_LINE_DUR = 1.4;

await mkdir(LYRICS_DIR, { recursive: true });

const src = await readFile(DATA_TS, 'utf8');
// Track blocks always contain `file: '/audio/...'` — albums never do.
// Each track block: { id: '...' ... file: '/audio/X.mp3' ... lyrics: [...] ... wisdom: '...' }
// Match track blocks: { id, title, artist, file, ... wisdom }. Tight enough that
// the preceding album-literal block (which has `description:` and no `artist:`)
// cannot be consumed into the lazy [\s\S]*? span.
const blocks = src.match(/\{\s*id:\s*'[^']+',\s*title:\s*'[^']+',\s*artist:\s*'[^']+',\s*file:\s*'\/audio\/[^']+'[\s\S]*?wisdom:[^\n]+\n\s*\}/g) || [];
const tracks = blocks.map(b => {
  const id = b.match(/id:\s*'([^']+)'/)?.[1];
  const file = b.match(/file:\s*'([^']+)'/)?.[1];
  const lyricsBlock = b.match(/lyrics:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  const lyrics = [...lyricsBlock.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m =>
    m[1].replace(/\\'/g, "'").replace(/\\"/g, '"')
  );
  return id && file && lyrics.length ? { id, file, lyrics } : null;
}).filter(Boolean);

console.log(`tracks parsed: ${tracks.length}`);

function syllableCount(line) {
  const cleaned = line.toLowerCase().replace(/[^a-z\s']/g, ' ').trim();
  if (!cleaned) return 1;
  const words = cleaned.split(/\s+/).filter(Boolean);
  let total = 0;
  for (const w of words) {
    let count = (w.match(/[aeiouy]+/g) || []).length;
    if (w.endsWith('e') && count > 1) count--;
    if (w.endsWith('le') && w.length > 2 && !'aeiouy'.includes(w[w.length - 3])) count++;
    total += Math.max(1, count);
  }
  return Math.max(1, total);
}

async function probeDuration(absPath) {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    absPath
  ]);
  return Number.parseFloat(stdout.trim());
}

async function alignOne(track) {
  const out = resolve(LYRICS_DIR, `${track.id}.json`);
  const mp3 = resolve(AUDIO_PUBLIC, track.file.replace(/^\//, ''));
  if (!existsSync(mp3)) {
    console.warn(`✗ ${track.id} → mp3 missing: ${mp3}`);
    return;
  }
  const duration = await probeDuration(mp3);
  if (!Number.isFinite(duration) || duration <= 0) {
    console.warn(`✗ ${track.id} → bad duration`);
    return;
  }

  const intro = Math.min(INTRO_PAD, Math.max(4, duration * 0.08));
  const outro = Math.min(OUTRO_PAD, Math.max(3, duration * 0.05));
  const vocalWindow = Math.max(MIN_LINE_DUR * track.lyrics.length, duration - intro - outro);

  const syllables = track.lyrics.map(syllableCount);
  const totalSyll = syllables.reduce((a, b) => a + b, 0);

  let cursor = intro;
  const lines = track.lyrics.map((text, i) => {
    const ratio = syllables[i] / totalSyll;
    const dur = Math.max(MIN_LINE_DUR, vocalWindow * ratio);
    const s = cursor;
    const e = cursor + dur;
    cursor = e;
    return { s: round2(s), e: round2(e), text };
  });

  await writeFile(out, JSON.stringify({
    lines,
    duration: round2(duration),
    source: 'aligned',
    intro: round2(intro),
    outro: round2(outro)
  }, null, 2));
  console.log(`✓ ${track.id} (${duration.toFixed(1)}s, intro ${intro.toFixed(1)}s, outro ${outro.toFixed(1)}s)`);
}

function round2(n) { return Math.round(n * 100) / 100; }

const concurrency = 4;
let i = 0;
async function worker() {
  while (i < tracks.length) {
    const t = tracks[i++];
    try { await alignOne(t); } catch (err) { console.error(`✗ ${t.id} → ${err.message}`); }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.log('done');
