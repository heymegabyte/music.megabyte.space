#!/usr/bin/env node
// One-pass clamp of zero/negative-span words across every public/lyrics/*.json.
// The aligner emits s==e on short syllables; the karaoke per-word glow can
// flicker on those. Stretch each toward the next word's start (cap +0.18s),
// never crossing it, and recompute line bounds. Idempotent — safe to re-run.
//
// Usage: node scripts/clamp-lyric-spans.mjs            # all files
//        node scripts/clamp-lyric-spans.mjs <id> ...   # specific files

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LYRICS_DIR = resolve(ROOT, 'public/lyrics');
const MIN = 0.08;

const args = process.argv.slice(2);
const targets = args.length
  ? args.map(a => `${a.replace(/\.json$/, '')}.json`)
  : (await readdir(LYRICS_DIR)).filter(f => f.endsWith('.json'));

let touched = 0,
  totalClamped = 0;
for (const f of targets) {
  const path = resolve(LYRICS_DIR, f);
  let d;
  try {
    d = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    console.warn(`skip ${f} (unreadable)`);
    continue;
  }
  const words = Array.isArray(d.words) ? d.words : [];
  const lines = Array.isArray(d.lines) ? d.lines : [];
  if (!words.length) continue;

  let clamped = 0;
  for (let i = 0; i < words.length; i++) {
    if (words[i].e - words[i].s >= MIN) continue;
    const next = words[i + 1];
    const lineEnd = lines[words[i].line]?.e ?? d.duration ?? words[i].s + MIN;
    const ceil = next ? next.s : lineEnd;
    words[i].e = +Math.min(Math.max(words[i].s + 0.18, words[i].e), Math.max(words[i].s + MIN, ceil)).toFixed(
      2
    );
    if (next && words[i].e > next.s) words[i].e = +Math.max(words[i].s + MIN, next.s).toFixed(2);
    clamped++;
  }
  if (!clamped) continue;
  // Recompute line bounds from clamped words.
  for (let li = 0; li < lines.length; li++) {
    const lw = words.filter(w => w.line === li);
    if (lw.length) {
      lines[li].s = lw[0].s;
      lines[li].e = lw[lw.length - 1].e;
    }
  }
  await writeFile(path, JSON.stringify(d));
  touched++;
  totalClamped += clamped;
  console.log(`✓ ${f.replace('.json', '')} — clamped ${clamped} words`);
}
console.log(`\nclamped ${totalClamped} words across ${touched} files`);
