#!/usr/bin/env node
// Realign curated lyric text onto an existing whisper timeline.
//
// Use case: the audio file's Suno output was imperfect — whisper transcribed
// what was actually sung, but we want to display the polished lyric text.
// This script:
//   1. Reads polished lyric LINES from src/data.ts for the given track IDs
//   2. Reads the existing public/lyrics/<id>.json for vocal-window bounds
//      (first/last audible word timestamp, skipping leading "🎵" markers)
//   3. Distributes lines across that vocal window weighted by syllable count
//   4. Within each line, distributes words across [line.s, line.e] weighted
//      by syllable count
//   5. Writes a fresh JSON with { words[], lines[], duration, source }
//
// Result: karaoke-grade word-level timing for the polished lyric text,
// without re-transcribing (whisper would just produce the imperfect text
// again because that's what the audio actually says).
//
// Usage: node scripts/realign-curated-words.mjs mama-called-us hobbit-kettle-fire

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LYRICS_DIR = resolve(ROOT, 'public/lyrics');
const DATA_TS = resolve(ROOT, 'src/data.ts');

const trackIds = process.argv.slice(2);
if (!trackIds.length) {
  console.error('Usage: realign-curated-words.mjs <track-id> [<track-id>...]');
  process.exit(1);
}

await mkdir(LYRICS_DIR, { recursive: true });
const dataSource = await readFile(DATA_TS, 'utf8');

// Same robust track parser as align-curated-lyrics.mjs — requires `file:` +
// `wisdom:` to disqualify album literals + handles escaped apostrophes
// inside the `lyrics:` array strings.
const blocks =
  dataSource.match(
    /\{\s*id:\s*'[^']+',\s*title:\s*'[^']+',\s*artist:\s*'[^']+',\s*file:\s*'\/audio\/[^']+'[\s\S]*?wisdom:[^\n]+\n\s*\}/g
  ) || [];
const TRACK_LYRICS = new Map();
for (const b of blocks) {
  const id = b.match(/id:\s*'([^']+)'/)?.[1];
  // Terminate on `\n    ]` (4-space indent + closing bracket) so lyric
  // lines containing literal `]` like '[Hook][choir]' don't cut the
  // capture short at the first inner `]`.
  const lyricsBlock = b.match(/lyrics:\s*\[([\s\S]*?)\n\s{4}\]/)?.[1] ?? '';
  const lyrics = [...lyricsBlock.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m =>
    m[1].replace(/\\'/g, "'").replace(/\\"/g, '"')
  );
  if (id && lyrics.length) TRACK_LYRICS.set(id, lyrics);
}

function syllableCount(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  let count = (w.match(/[aeiouy]+/g) || []).length;
  if (w.endsWith('e') && count > 1) count--;
  if (w.endsWith('le') && w.length > 2 && !'aeiouy'.includes(w[w.length - 3])) count++;
  return Math.max(1, count);
}
function lineSyllables(line) {
  return (
    line
      .split(/\s+/)
      .filter(Boolean)
      .reduce((a, w) => a + syllableCount(w), 0) || 1
  );
}

// Vocal window = first audible (non-emoji, non-empty) word start → last
// audible word end. Whisper often emits "🎵" markers around intro/outro
// instrumentals; we want our polished lines to land on actual singing.
function vocalBounds(existing) {
  const audible = existing.words.filter(w => w.w && !/^[🎵🎶🎼\s]+$/.test(w.w));
  if (audible.length === 0) return { s: 0, e: existing.duration || 0 };
  return { s: audible[0].s, e: audible[audible.length - 1].e };
}

async function realignTrackAsync(id, polishedLines) {
  const existingPath = resolve(LYRICS_DIR, `${id}.json`);
  if (!existsSync(existingPath)) throw new Error(`no existing lyric file for ${id}`);
  const existing = JSON.parse(await readFile(existingPath, 'utf8'));
  const duration = Number(existing.duration) || 0;
  const { s: vocalStart, e: vocalEnd } = vocalBounds(existing);
  const vocalWindow = Math.max(1, vocalEnd - vocalStart);

  // Distribute LINES across the vocal window weighted by syllable count.
  const lineSyll = polishedLines.map(lineSyllables);
  const totalSyll = lineSyll.reduce((a, b) => a + b, 0);

  let cursor = vocalStart;
  const linesOut = [];
  const wordsOut = [];

  polishedLines.forEach((text, lineIdx) => {
    const lineRatio = lineSyll[lineIdx] / totalSyll;
    const lineDur = Math.max(0.9, vocalWindow * lineRatio);
    const lineStart = cursor;
    const lineEnd = cursor + lineDur;
    cursor = lineEnd;

    // Within the line, distribute words across [lineStart, lineEnd]
    // weighted by syllable count. Each word gets a real (s, e) so the
    // karaoke renderer can highlight word-by-word.
    const words = text.split(/\s+/).filter(Boolean);
    const wordSyll = words.map(syllableCount);
    const wordSyllTotal = wordSyll.reduce((a, b) => a + b, 0) || 1;
    let wc = lineStart;
    words.forEach((w, wi) => {
      const wRatio = wordSyll[wi] / wordSyllTotal;
      const wDur = Math.max(0.06, lineDur * wRatio);
      const wStart = wc;
      const wEnd = Math.min(lineEnd, wc + wDur);
      wc = wEnd;
      wordsOut.push({
        w,
        s: +wStart.toFixed(3),
        e: +wEnd.toFixed(3),
        line: lineIdx
      });
    });

    linesOut.push({
      s: +lineStart.toFixed(3),
      e: +lineEnd.toFixed(3),
      text
    });
  });

  // Clamp the trailing line to vocalEnd to avoid drift accumulated by
  // Math.max() floors above.
  if (linesOut.length) {
    const last = linesOut[linesOut.length - 1];
    last.e = +vocalEnd.toFixed(3);
    // Bump the trailing words too.
    for (let i = wordsOut.length - 1; i >= 0; i--) {
      if (wordsOut[i].line !== linesOut.length - 1) break;
      if (wordsOut[i].e > vocalEnd) wordsOut[i].e = +vocalEnd.toFixed(3);
      if (wordsOut[i].s > vocalEnd) wordsOut[i].s = +vocalEnd.toFixed(3);
    }
  }

  const payload = {
    words: wordsOut,
    lines: linesOut,
    duration,
    source: 'curated-realigned',
    generatedAt: new Date().toISOString(),
    realignedFrom: existing.source || 'unknown',
    vocalStart: +vocalStart.toFixed(3),
    vocalEnd: +vocalEnd.toFixed(3)
  };
  await writeFile(existingPath, JSON.stringify(payload));
  return {
    id,
    lines: linesOut.length,
    words: wordsOut.length,
    duration,
    vocalStart: vocalStart.toFixed(2),
    vocalEnd: vocalEnd.toFixed(2)
  };
}

for (const id of trackIds) {
  const polished = TRACK_LYRICS.get(id);
  if (!polished) {
    console.error(`✗ ${id} — not found in src/data.ts`);
    process.exitCode = 1;
    continue;
  }
  try {
    const r = await realignTrackAsync(id, polished);
    console.log(
      `✓ ${r.id} — ${r.lines} lines, ${r.words} words across ${r.vocalStart}s–${r.vocalEnd}s (audio ${r.duration.toFixed(1)}s)`
    );
  } catch (err) {
    console.error(`✗ ${id} — ${err.message}`);
    process.exitCode = 1;
  }
}
