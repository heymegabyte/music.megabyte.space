#!/usr/bin/env node
// Rebuild public/lyrics/<id>.json straight from the whisper-cache transcript.
//
// Use when a track's stored lyrics are the WRONG take (different Suno render than
// the audio) or polluted with prompt metadata — the Needleman-Wunsch aligner
// (align-whisper-lyrics.mjs) can't fix that because it's aligning the wrong words.
// The cache holds accurate per-word timestamps of what was ACTUALLY sung, so we
// rebuild words + lines + the data.ts static lyrics from it.
//
// Usage: node scripts/rebuild-lyrics-from-cache.mjs <id> [<id>...]
//        node scripts/rebuild-lyrics-from-cache.mjs <id> --no-data   # skip data.ts sync
//
// NEVER run this on a track whose cache transcript is garbage (e.g. rapid-number
// rap Whisper mis-hears) — that would replace good lyrics with noise. Check the
// cache first. See ~/.claude memory project_lyric_timing_mismatch.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CACHE_DIR = resolve(ROOT, 'data/whisper-cache');
const LYRICS_DIR = resolve(ROOT, 'public/lyrics');
const DATA_TS = resolve(ROOT, 'src/data.ts');

const args = process.argv.slice(2);
const syncData = !args.includes('--no-data');
const ids = args.filter(a => !a.startsWith('--'));
if (!ids.length) {
  console.error('Usage: rebuild-lyrics-from-cache.mjs <id> [<id>...] [--no-data]');
  process.exit(1);
}

const isMusic = s => !s || /^[\s♪♫🎵🎶🎼·.\-]*$/.test(s);
const clean = s => (s || '').replace(/[♪♫🎵🎶🎼]/g, ' ').replace(/\s+/g, ' ').trim();
const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9 ]/g, '');

function buildFromCache(cache) {
  const segs = cache.segments || [];
  const allWords = (cache.words || []).map(w => ({
    w: w.word ?? w.w ?? '',
    s: Number(w.start ?? w.s),
    e: Number(w.end ?? w.e)
  }));

  // Candidate lines from segments, words bucketed by segment time window.
  const cand = [];
  for (const seg of segs) {
    const text = clean(seg.text);
    if (!text) continue;
    const segStart = Number(seg.start), segEnd = Number(seg.end);
    const segWords = allWords.filter(w => w.s >= segStart - 0.01 && w.s < segEnd + 0.01 && !isMusic(w.w));
    if (!segWords.length) continue;
    cand.push({ text, words: segWords });
  }

  // Dedupe consecutive identical lines (overlapping segments emit a take twice).
  const merged = [];
  for (const c of cand) {
    const prev = merged[merged.length - 1];
    if (prev && norm(prev.text) === norm(c.text)) {
      if (c.words.length > prev.words.length) { prev.words = c.words; prev.text = c.text; }
      continue;
    }
    merged.push(c);
  }

  const lines = [];
  const words = [];
  merged.forEach((c, lineIdx) => {
    for (const w of c.words) words.push({ w: w.w, s: +w.s.toFixed(2), e: +w.e.toFixed(2), line: lineIdx });
    lines.push({ s: +c.words[0].s.toFixed(2), e: +c.words[c.words.length - 1].e.toFixed(2), text: c.text });
  });

  // Guarantee a positive span per word so per-word glow never flickers.
  const MIN = 0.08;
  for (let i = 0; i < words.length; i++) {
    const next = words[i + 1];
    const ceil = next ? next.s : lines[words[i].line].e;
    if (words[i].e - words[i].s < MIN) {
      words[i].e = +Math.min(Math.max(words[i].s + 0.18, words[i].e), Math.max(words[i].s + MIN, ceil)).toFixed(2);
    }
    if (next && words[i].e > next.s) words[i].e = +Math.max(words[i].s + MIN, next.s).toFixed(2);
  }
  for (let li = 0; li < lines.length; li++) {
    const lw = words.filter(w => w.line === li);
    if (lw.length) { lines[li].s = lw[0].s; lines[li].e = lw[lw.length - 1].e; }
  }

  return { words, lines, duration: +Number(cache.duration).toFixed(2), source: 'whisper', generatedAt: '2026-06-01T00:00:00.000Z' };
}

async function syncDataTs(id, lines) {
  // Drop the "Mm-mm" hum intro from display lyrics; keep real sung lines.
  const display = lines.map(l => l.text.replace(/\s+/g, ' ').trim()).filter(Boolean).filter(t => !/^mm[-\s]?/i.test(t));
  const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const arr = '[\n' + display.map(l => `      '${esc(l)}'`).join(',\n') + '\n    ]';
  let src = await readFile(DATA_TS, 'utf8');
  const idIdx = src.indexOf(`id: '${id}'`);
  if (idIdx < 0) { console.warn(`  ⚠ ${id} not found in data.ts — skipping data sync`); return 0; }
  const lyrStart = src.indexOf('lyrics: [', idIdx);
  const closeRel = src.indexOf('\n    ]', lyrStart);
  if (lyrStart < 0 || closeRel < 0) { console.warn(`  ⚠ ${id} lyrics array bounds not found`); return 0; }
  const closeEnd = closeRel + '\n    ]'.length;
  src = src.slice(0, lyrStart) + 'lyrics: ' + arr + src.slice(closeEnd);
  await writeFile(DATA_TS, src);
  return display.length;
}

for (const id of ids) {
  const cachePath = resolve(CACHE_DIR, `${id}.json`);
  if (!existsSync(cachePath)) { console.error(`✗ ${id} — no whisper cache at ${cachePath}`); continue; }
  const cache = JSON.parse(await readFile(cachePath, 'utf8'));
  const out = buildFromCache(cache);
  await writeFile(resolve(LYRICS_DIR, `${id}.json`), JSON.stringify(out));
  let dataLines = 0;
  if (syncData) dataLines = await syncDataTs(id, out.lines);
  console.log(`✓ ${id} — ${out.lines.length} lines, ${out.words.length} words, source=whisper${syncData ? `, data.ts=${dataLines} lines` : ''}`);
}
