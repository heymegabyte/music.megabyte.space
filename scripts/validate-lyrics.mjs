#!/usr/bin/env node
// Lyric-quality gate. Catches the two ways karaoke timing silently breaks:
//   1. WRONG TAKE — data.ts lyrics are a different Suno render than the audio,
//      so the aligner matches almost nothing (low stats.matchRate).
//   2. COLLAPSED LINES — many lines pinned to one timestamp (the outro bug),
//      i.e. distinct lines sharing identical start times.
// Also flags structural corruption: non-monotonic word/line times, zero-span
// words, out-of-range timestamps.
//
// Exit non-zero on any failure so it can gate the build. Run: node scripts/validate-lyrics.mjs
//
// ALLOWLIST: tracks whose Whisper transcript is legitimately garbage (rapid
// number-rap, heavy FX) keep correct hand-written lyrics that simply can't be
// auto-aligned. They're exempt from the match-rate floor (timing only, words OK).

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LYRICS_DIR = resolve(ROOT, 'public/lyrics');

const MATCH_FLOOR = 0.6;          // below this = almost certainly the wrong take
const COLLAPSE_MAX = 3;           // >N distinct lines sharing one start = collapsed

// Whisper-can't-hear-this tracks: correct lyrics, un-alignable audio. Timing is
// best-effort; words are authoritative. Exempt from the match-rate floor only.
const MATCH_RATE_EXEMPT = new Set([
  'cbo-pen' // rapid economic-number rap — Whisper hears "4 4 9 1 9"; lyrics are correct
]);

const files = (await readdir(LYRICS_DIR)).filter(f => f.endsWith('.json'));
const failures = [];
const warnings = [];

for (const f of files) {
  const id = f.replace('.json', '');
  let d;
  try { d = JSON.parse(await readFile(resolve(LYRICS_DIR, f), 'utf8')); }
  catch (e) { failures.push(`${id}: invalid JSON (${e.message})`); continue; }

  const words = Array.isArray(d.words) ? d.words : [];
  const lines = Array.isArray(d.lines) ? d.lines : [];
  if (!lines.length) { warnings.push(`${id}: no lines`); continue; }

  // 1. Match rate (wrong-take detector)
  const mr = d.stats?.matchRate;
  if (typeof mr === 'number' && mr < MATCH_FLOOR && !MATCH_RATE_EXEMPT.has(id)) {
    failures.push(`${id}: matchRate ${(mr * 100).toFixed(0)}% < ${MATCH_FLOOR * 100}% — likely WRONG TAKE; rebuild via scripts/rebuild-lyrics-from-cache.mjs`);
  }

  // 2. Collapsed lines (outro bug): distinct lines sharing one start time
  const startCounts = new Map();
  for (const l of lines) {
    const k = (l.s ?? 0).toFixed(2);
    startCounts.set(k, (startCounts.get(k) || 0) + 1);
  }
  const worstCluster = Math.max(0, ...startCounts.values());
  if (worstCluster > COLLAPSE_MAX) {
    failures.push(`${id}: ${worstCluster} lines collapsed onto one timestamp — re-zip onto real word times`);
  }

  // 3. Structural integrity (only meaningful when word timings exist).
  //    HARD-FAIL on real corruption (out-of-range, badly out-of-order).
  //    WARN on cosmetic zero-span words — the aligner emits these on short
  //    syllables across most files and the renderer tolerates them; not worth
  //    blocking a deploy. Rebuilds via rebuild-lyrics-from-cache.mjs clamp them.
  if (words.length) {
    const last = words[words.length - 1];
    if (typeof d.duration === 'number' && last.e > d.duration + 1) {
      failures.push(`${id}: last word ends ${last.e}s past duration ${d.duration}s`);
    }
    // Gross ordering breakage (a word starting >2s before the previous one) is
    // corruption; tiny equal-time ties are normal.
    let grossOutOfOrder = 0;
    for (let i = 0; i < words.length - 1; i++) if (words[i].s - words[i + 1].s > 2) grossOutOfOrder++;
    if (grossOutOfOrder) failures.push(`${id}: ${grossOutOfOrder} words grossly out of time order (>2s backwards)`);

    // Zero-span words (per-word glow flicker). Debt was cleared 2026-06 via
    // scripts/clamp-lyric-spans.mjs, so this is now a hard fail — re-run that
    // script after any rebuild to keep it clean.
    const zero = words.filter(w => (w.e - w.s) <= 0).length;
    if (zero) failures.push(`${id}: ${zero} zero-span words — run \`node scripts/clamp-lyric-spans.mjs ${id}\``);
  }
}

if (warnings.length) {
  console.log('⚠ warnings:');
  for (const w of warnings) console.log('  ' + w);
}
if (failures.length) {
  console.error(`\n✗ lyric validation FAILED (${failures.length}):`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`✓ lyric validation passed — ${files.length} files clean (match floor ${MATCH_FLOOR * 100}%, ${MATCH_RATE_EXEMPT.size} match-rate exempt)`);
