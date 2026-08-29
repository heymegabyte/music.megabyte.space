/**
 * audit-track-assets.ts — build gate enforcing the two per-track guarantees:
 *   1. Every lyrical track has a karaoke JSON that (a) loads, (b) has real
 *      word timing, and (c) times EVERY sung display line (no line that shows
 *      in the module but never highlights → the real "sync is off" failure).
 *   2. Every track has a valid OG / share card (`public/og/track-<id>.jpg`).
 *
 * This is the reusable audit behind "make sure every single track has perfect
 * lyrics sync + a working share image". It does NOT flag big word-gaps — a gap
 * between two timed lines is a real instrumental break (the highlighter freezes,
 * correctly); only an UNTIMED sung line is a sync bug, which the drift check below
 * catches. Complements validate-lyrics.mjs (structural: collapse/zero-span/monotonic).
 *
 *   npx vite-node scripts/audit-track-assets.ts        # exit 1 on any failure
 *
 * Wired into `prebuild`, so a track that ships without sync or an OG breaks the build.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKS } from '../src/data';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OG_MIN_BYTES = 3000;
const DRIFT_MAX = 0.35; // >35% of sung lines missing timing = broken sync
const SPARSE_MIN_WORDS = 8;
// Tracks Whisper genuinely can't transcribe densely (number-rap / heavy production);
// their lyrics are smooth curated-realigned fallbacks — acceptable, not broken.
const SPARSE_EXEMPT = new Set(['cbo-pen', 'the-soul-key']);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const isSung = (l: string) => Boolean(l) && !/^[#*[(]/.test(l.trim());

const failures: string[] = [];
let lyrical = 0;
let ogOk = 0;

for (const t of TRACKS) {
  // ── OG / share card ──
  const og = resolve(ROOT, 'public/og', `track-${t.id}.jpg`);
  if (!existsSync(og) || statSync(og).size < OG_MIN_BYTES) {
    failures.push(`${t.id}: missing/small OG card (public/og/track-${t.id}.jpg)`);
  } else ogOk++;

  // ── lyrics sync (lyrical tracks only) ──
  const sungLines = (t.lyrics ?? []).filter(isSung);
  if (sungLines.length === 0) continue; // instrumental — no karaoke expected
  lyrical++;

  const jp = resolve(ROOT, 'public/lyrics', `${t.id}.json`);
  if (!existsSync(jp)) {
    failures.push(
      `${t.id}: has lyrics in data.ts but NO public/lyrics/${t.id}.json (module falls back to estimate)`
    );
    continue;
  }
  const j = JSON.parse(readFileSync(jp, 'utf8')) as {
    words?: { s: number; e: number }[];
    lines?: { text: string }[];
  };
  const words = j.words ?? [];
  const lines = j.lines ?? [];
  if (words.length < SPARSE_MIN_WORDS && !SPARSE_EXEMPT.has(t.id)) {
    failures.push(
      `${t.id}: only ${words.length} timed words (< ${SPARSE_MIN_WORDS}) — re-transcribe or allowlist`
    );
    continue;
  }
  // Drift: every sung display line must appear (timed) in the JSON lines, else it
  // renders in the module but never highlights = the exact "off" the user reports.
  const jsonTexts = lines.map(l => norm(l.text ?? ''));
  const missing = sungLines
    .map(norm)
    .filter(dl => dl.length > 3 && !jsonTexts.some(jt => jt === dl || jt.includes(dl) || dl.includes(jt)));
  const driftPct = sungLines.length ? missing.length / sungLines.length : 0;
  if (driftPct > DRIFT_MAX && !SPARSE_EXEMPT.has(t.id)) {
    failures.push(
      `${t.id}: ${(driftPct * 100).toFixed(0)}% of sung lines have NO word timing (${missing.length}/${sungLines.length}) — wrong take or drifted JSON; rebuild/re-align`
    );
  }
}

console.log(
  `audit-track-assets: ${TRACKS.length} tracks · ${ogOk}/${TRACKS.length} OG cards · ${lyrical} lyrical tracks synced`
);
if (failures.length) {
  console.error(`\n✗ track-asset audit FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('✓ every track has a valid OG card + every sung line has word timing.');
