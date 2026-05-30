#!/usr/bin/env node
// Word-level alignment of polished Suno lyrics to whisper transcripts.
//
// The realign-curated-words.mjs script distributed words proportionally
// by syllable count across the vocal window — good approximation but
// not EXACT per-word sync. This script gives true word-level timing by:
//
//   1. Loading the polished lyric LINES from src/data.ts (the lyrics
//      Suno was prompted to sing — clean, formatted, with section
//      structure)
//   2. Loading the whisper transcript from data/whisper-cache/<id>.json
//      (real per-word timestamps of what was actually sung — may have
//      misheard words, contractions, ums, repeated phrases)
//   3. Tokenizing both into normalized words (lowercase, stripped
//      punctuation, contractions expanded)
//   4. Needleman-Wunsch global alignment with: match=+2, mismatch=-1,
//      gap=-1.5. Returns aligned pairs.
//   5. For each polished word: if matched to a whisper word, use that
//      timestamp. If unmatched, linearly interpolate between nearest
//      aligned anchor pair.
//   6. Group polished words back into the original LINE structure;
//      each line's [s,e] = first word's start → last word's end.
//   7. Write public/lyrics/<id>.json with source='whisper-aligned' +
//      every polished word having a real or interpolated timestamp.
//
// Usage: node scripts/align-whisper-lyrics.mjs           # all tracks
//        node scripts/align-whisper-lyrics.mjs <id> …    # specific tracks
//        node scripts/align-whisper-lyrics.mjs --force   # ignore is-already-aligned

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DATA_TS = resolve(ROOT, 'src/data.ts');
const CACHE_DIR = resolve(ROOT, 'data/whisper-cache');
const LYRICS_DIR = resolve(ROOT, 'public/lyrics');

const args = process.argv.slice(2);
const force = args.includes('--force');
const targets = args.filter(a => !a.startsWith('--'));

await mkdir(LYRICS_DIR, { recursive: true });

// ---------- Parse polished lyrics from data.ts -----------------------------

function parseTracks(src) {
  const start = src.search(/export const TRACKS\s*:\s*Track\[\]\s*=\s*\[/);
  if (start < 0) return [];
  const region = src.slice(start);
  // Accept both single- and double-quoted id/title fields so freshly
  // imported tracks (which often serialize as double-quoted) parse too.
  const blocks = region.match(/\{\s*id:\s*['"][^'"]+['"],\s*title:\s*['"][^'"]+['"][\s\S]*?wisdom:[^\n]+\n\s*\}/g) || [];
  return blocks.map(b => {
    const id = b.match(/id:\s*['"]([^'"]+)['"]/)?.[1];
    const lyricsBlock = b.match(/lyrics:\s*\[([\s\S]*?)\n\s{4}\]/)?.[1] ?? '';
    // Match both 'single' and "double" quoted lyric strings.
    const lines = [...lyricsBlock.matchAll(/(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)].map(m =>
      (m[1] ?? m[2] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"')
    );
    return id ? { id, lines } : null;
  }).filter(Boolean);
}

// ---------- Tokenization + normalization -----------------------------------

const CONTRACTIONS = new Map([
  ["i'm", 'i am'], ["i've", 'i have'], ["i'll", 'i will'], ["i'd", 'i would'],
  ["you're", 'you are'], ["you've", 'you have'], ["you'll", 'you will'], ["you'd", 'you would'],
  ["he's", 'he is'], ["she's", 'she is'], ["it's", 'it is'],
  ["we're", 'we are'], ["we've", 'we have'], ["we'll", 'we will'], ["we'd", 'we would'],
  ["they're", 'they are'], ["they've", 'they have'], ["they'll", 'they will'], ["they'd", 'they would'],
  ["don't", 'do not'], ["doesn't", 'does not'], ["didn't", 'did not'],
  ["won't", 'will not'], ["wouldn't", 'would not'], ["shouldn't", 'should not'],
  ["can't", 'can not'], ["cannot", 'can not'], ["couldn't", 'could not'],
  ["isn't", 'is not'], ["aren't", 'are not'], ["wasn't", 'was not'], ["weren't", 'were not'],
  ["that's", 'that is'], ["there's", 'there is'], ["what's", 'what is'], ["where's", 'where is'],
  ["who's", 'who is'], ["how's", 'how is'], ["let's", 'let us'],
  ["ain't", 'is not'], ["y'all", 'you all'], ["gonna", 'going to'], ["wanna", 'want to'], ["gotta", 'got to'],
  ["'em", 'them'], ["'cause", 'because'], ["'til", 'until']
]);

function normWord(w) {
  if (!w) return '';
  // Lower-case, replace fancy apostrophes, strip surrounding punct.
  let s = w.toLowerCase().replace(/[’`]/g, "'").trim();
  s = s.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, '');
  return s;
}

function expandContraction(w) {
  return CONTRACTIONS.get(w) || w;
}

/** Tokenize a string into normalized words. Strips section markers
 *  ([Hook], [Verse 1], etc.) entirely, expands contractions inline,
 *  drops empties. Returns [{w: normalized, orig: original-with-punct,
 *  lineIdx: int}]. */
function tokenizePolishedLines(lines) {
  const out = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const text = lines[lineIdx];
    if (/^(?:\[[^\]]*\]\s*)+$/.test(text.trim())) continue; // skip pure-tag lines
    // Strip in-line section tags like [chorus] / [whispered]
    const cleaned = text.replace(/\[[^\]]+\]/g, ' ');
    const rawTokens = cleaned.split(/\s+/).filter(Boolean);
    for (const raw of rawTokens) {
      const n = normWord(raw);
      if (!n) continue;
      const expanded = expandContraction(n);
      if (expanded === n) {
        out.push({ w: n, orig: raw, lineIdx });
      } else {
        // Expanded contraction: emit each sub-word but keep orig on first
        const parts = expanded.split(' ');
        out.push({ w: parts[0], orig: raw, lineIdx, _contractionStart: true });
        for (let i = 1; i < parts.length; i++) {
          out.push({ w: parts[i], orig: '', lineIdx, _contractionContinue: true });
        }
      }
    }
  }
  return out;
}

function tokenizeWhisperWords(words) {
  // Whisper output: { word, start, end }
  const out = [];
  for (const w of words) {
    const raw = (w.word || '').trim();
    if (!raw) continue;
    const n = normWord(raw);
    if (!n) continue;
    const expanded = expandContraction(n);
    if (expanded === n) {
      out.push({ w: n, s: Number(w.start), e: Number(w.end) });
    } else {
      // Whisper contraction: split timing evenly across sub-words.
      const parts = expanded.split(' ');
      const dur = (Number(w.end) - Number(w.start)) / parts.length;
      for (let i = 0; i < parts.length; i++) {
        out.push({
          w: parts[i],
          s: Number(w.start) + dur * i,
          e: Number(w.start) + dur * (i + 1)
        });
      }
    }
  }
  return out;
}

// ---------- Needleman-Wunsch sequence alignment ----------------------------

/** Global alignment of two word sequences. Returns array of pairs
 *  [{a: idxInA|-1, b: idxInB|-1}] in order. -1 indicates a gap.
 *  Standard NW with match=+2, mismatch=-1, gap=-1.5. For long lyrics
 *  (~500 words × ~500 words = 250k cells) this is fast enough (~20ms). */
function needlemanWunsch(a, b) {
  const n = a.length, m = b.length;
  const MATCH = 2, MISMATCH = -1, GAP = -1.5;
  // Use Int32Array for the score matrix to keep memory small.
  // For n*m up to 1M cells we'd need 4MB — fine.
  const score = new Float32Array((n + 1) * (m + 1));
  const trace = new Uint8Array((n + 1) * (m + 1));  // 0=stop, 1=diag, 2=up, 3=left
  for (let i = 1; i <= n; i++) { score[i * (m + 1)] = i * GAP; trace[i * (m + 1)] = 2; }
  for (let j = 1; j <= m; j++) { score[j] = j * GAP; trace[j] = 3; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const idx = i * (m + 1) + j;
      const diag = score[(i - 1) * (m + 1) + (j - 1)] + (a[i - 1].w === b[j - 1].w ? MATCH : MISMATCH);
      const up = score[(i - 1) * (m + 1) + j] + GAP;
      const left = score[i * (m + 1) + (j - 1)] + GAP;
      let best = diag, t = 1;
      if (up > best) { best = up; t = 2; }
      if (left > best) { best = left; t = 3; }
      score[idx] = best;
      trace[idx] = t;
    }
  }
  // Trace-back
  const pairs = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const t = trace[i * (m + 1) + j];
    if (i > 0 && j > 0 && t === 1) { pairs.push({ a: i - 1, b: j - 1 }); i--; j--; }
    else if (i > 0 && t === 2) { pairs.push({ a: i - 1, b: -1 }); i--; }
    else { pairs.push({ a: -1, b: j - 1 }); j--; }
  }
  pairs.reverse();
  return pairs;
}

// ---------- Per-track alignment --------------------------------------------

async function alignTrack(id, polishedLines) {
  const cachePath = resolve(CACHE_DIR, `${id}.json`);
  if (!existsSync(cachePath)) return { id, status: 'no-whisper-cache' };
  const whisper = JSON.parse(await readFile(cachePath, 'utf8'));
  const whisperTokens = tokenizeWhisperWords(whisper.words || []);
  const polishedTokens = tokenizePolishedLines(polishedLines);
  if (!polishedTokens.length) return { id, status: 'no-polished-lyrics' };
  if (!whisperTokens.length) return { id, status: 'empty-whisper' };

  // For very long sequences (>800 words on either side), fall back to
  // chunked alignment to avoid memory blowup.
  let pairs;
  if (polishedTokens.length * whisperTokens.length > 1_500_000) {
    pairs = chunkedAlign(polishedTokens, whisperTokens);
  } else {
    pairs = needlemanWunsch(polishedTokens, whisperTokens);
  }

  // For each polished word, find timestamp. matchedIdx → use whisper's
  // [s,e]. Unmatched → linearly interpolate between nearest matched
  // anchors before + after.
  const polishedTimes = new Array(polishedTokens.length).fill(null);
  let matchedCount = 0;
  for (const p of pairs) {
    if (p.a >= 0 && p.b >= 0) {
      const wp = polishedTokens[p.a];
      const ww = whisperTokens[p.b];
      if (wp.w === ww.w) {
        polishedTimes[p.a] = { s: ww.s, e: ww.e, matched: true };
        matchedCount++;
      } else {
        // Mismatch in alignment — store as soft anchor at lower priority
        polishedTimes[p.a] = { s: ww.s, e: ww.e, matched: false };
      }
    }
  }
  // Interpolate gaps. Walk forward, find next-anchor distance, linearly
  // distribute between anchors.
  const totalDuration = whisper.duration || 0;
  // Fallback anchors: 0 → first matched, last matched → totalDuration
  let firstMatched = polishedTimes.findIndex(p => p);
  let lastMatched = -1;
  for (let i = polishedTimes.length - 1; i >= 0; i--) {
    if (polishedTimes[i]) { lastMatched = i; break; }
  }
  if (firstMatched < 0) firstMatched = 0;
  if (lastMatched < 0) lastMatched = polishedTokens.length - 1;

  // Sentinel: head + tail interpolation pins
  if (!polishedTimes[0]) {
    const headEnd = polishedTimes[firstMatched]?.s ?? 0;
    polishedTimes[0] = { s: Math.max(0, headEnd * 0.3), e: Math.max(0.1, headEnd * 0.3 + 0.2), matched: false };
  }
  if (!polishedTimes[polishedTokens.length - 1]) {
    const tailStart = polishedTimes[lastMatched]?.e ?? totalDuration;
    const endTime = totalDuration > tailStart ? totalDuration : tailStart + 1;
    polishedTimes[polishedTokens.length - 1] = { s: tailStart, e: endTime, matched: false };
  }

  // Linear interpolation pass
  let i = 0;
  while (i < polishedTimes.length) {
    if (polishedTimes[i]) { i++; continue; }
    // Find anchors before + after
    let before = i - 1;
    while (before >= 0 && !polishedTimes[before]) before--;
    let after = i;
    while (after < polishedTimes.length && !polishedTimes[after]) after++;
    if (before < 0 || after >= polishedTimes.length) { i++; continue; }
    const beforeT = polishedTimes[before].e;
    const afterT = polishedTimes[after].s;
    const gap = after - before;
    const slot = (afterT - beforeT) / gap;
    for (let k = before + 1; k < after; k++) {
      const start = beforeT + slot * (k - before - 1);
      const end = beforeT + slot * (k - before);
      polishedTimes[k] = { s: start, e: end, matched: false, interpolated: true };
    }
    i = after;
  }

  // Build word + line output. Group by line, compute line [s,e].
  const wordsOut = [];
  const linesByIdx = new Map();
  for (let i = 0; i < polishedTokens.length; i++) {
    const p = polishedTokens[i];
    const t = polishedTimes[i];
    if (!t) continue;
    // Reconstruct displayable word: use original token (preserves punctuation)
    // unless contraction continuation, in which case skip (handled by start token).
    if (p._contractionContinue) continue;
    const displayWord = p.orig || p.w;
    const wordEntry = {
      w: displayWord,
      s: +Math.max(0, t.s).toFixed(3),
      e: +Math.max(t.s, t.e).toFixed(3),
      line: p.lineIdx
    };
    wordsOut.push(wordEntry);
    if (!linesByIdx.has(p.lineIdx)) linesByIdx.set(p.lineIdx, { s: t.s, e: t.e });
    else {
      const existing = linesByIdx.get(p.lineIdx);
      existing.e = t.e;
    }
  }

  // Emit lines in declaration order — including dropped pure-tag lines as
  // synthetic placeholders that inherit timing from neighbors so the
  // overlay's line indexing matches the source array.
  const linesOut = [];
  for (let li = 0; li < polishedLines.length; li++) {
    const span = linesByIdx.get(li);
    const text = polishedLines[li];
    if (span) {
      linesOut.push({ s: +span.s.toFixed(3), e: +span.e.toFixed(3), text });
    } else {
      // Inherit from previous line end (or 0)
      const prev = linesOut[linesOut.length - 1];
      const inhS = prev?.e ?? 0;
      linesOut.push({ s: +inhS.toFixed(3), e: +(inhS + 0.5).toFixed(3), text });
    }
  }

  // Re-stamp word.line to point at indices that survived (collapse dropped tag lines)
  // -- actually keep original indexing so callers using lines[i] match.
  // Re-index words[].line if needed: lines indices already point at original line ids.

  const outPath = resolve(LYRICS_DIR, `${id}.json`);
  const payload = {
    words: wordsOut,
    lines: linesOut,
    duration: +totalDuration.toFixed(3),
    source: 'whisper-aligned',
    generatedAt: new Date().toISOString(),
    stats: {
      whisperWords: whisperTokens.length,
      polishedWords: polishedTokens.length,
      matched: matchedCount,
      matchRate: +(matchedCount / polishedTokens.length).toFixed(3)
    }
  };
  await writeFile(outPath, JSON.stringify(payload));
  return {
    id,
    status: 'ok',
    wp: polishedTokens.length,
    ww: whisperTokens.length,
    matched: matchedCount,
    rate: matchedCount / polishedTokens.length
  };
}

/** Chunked alignment for very long sequences. Splits polished into
 *  chunks of ~250 words, anchors each chunk to a corresponding region
 *  of whisper via duration ratio, runs NW per chunk. Sacrifices a tiny
 *  bit of global optimality for O(n) memory. */
function chunkedAlign(polished, whisper) {
  const CHUNK = 250;
  const pairs = [];
  const whisperRatio = whisper.length / polished.length;
  for (let i = 0; i < polished.length; i += CHUNK) {
    const pSlice = polished.slice(i, i + CHUNK);
    const wStart = Math.max(0, Math.floor(i * whisperRatio) - 30);
    const wEnd = Math.min(whisper.length, Math.ceil((i + CHUNK) * whisperRatio) + 30);
    const wSlice = whisper.slice(wStart, wEnd);
    const chunkPairs = needlemanWunsch(pSlice, wSlice);
    for (const cp of chunkPairs) {
      pairs.push({
        a: cp.a >= 0 ? cp.a + i : -1,
        b: cp.b >= 0 ? cp.b + wStart : -1
      });
    }
  }
  return pairs;
}

// ---------- Main -----------------------------------------------------------

const src = await readFile(DATA_TS, 'utf8');
const allTracks = parseTracks(src);
const trackMap = new Map(allTracks.map(t => [t.id, t]));
let toProcess;
if (targets.length) {
  toProcess = targets.map(id => trackMap.get(id)).filter(Boolean);
} else {
  toProcess = allTracks;
}
console.log(`Processing ${toProcess.length} track(s)…`);

let ok = 0, skip = 0, fail = 0;
const summaries = [];
for (let i = 0; i < toProcess.length; i++) {
  const t = toProcess[i];
  const tag = `[${i + 1}/${toProcess.length}] ${t.id}`.padEnd(40);
  // Idempotent: if already aligned + not --force, skip
  const outPath = resolve(LYRICS_DIR, `${t.id}.json`);
  if (!force && existsSync(outPath)) {
    try {
      const existing = JSON.parse(await readFile(outPath, 'utf8'));
      if (existing.source === 'whisper-aligned' && existing.stats?.matchRate >= 0.4) {
        skip++;
        console.log(`${tag} — cached (rate ${(existing.stats.matchRate * 100).toFixed(0)}%)`);
        continue;
      }
    } catch { /* fall through */ }
  }
  const r = await alignTrack(t.id, t.lines);
  if (r.status === 'ok') {
    ok++;
    summaries.push(r);
    const pct = (r.rate * 100).toFixed(0);
    const tag2 = r.rate >= 0.6 ? '✓' : r.rate >= 0.4 ? '~' : '⚠';
    console.log(`${tag} ${tag2} ${r.matched}/${r.wp} polished matched · ww=${r.ww} · ${pct}%`);
  } else {
    fail++;
    console.warn(`${tag} ✗ ${r.status}`);
  }
}

console.log(`\n${ok} aligned · ${skip} cached · ${fail} failed`);
if (ok > 0) {
  const avgRate = summaries.reduce((s, r) => s + r.rate, 0) / summaries.length;
  console.log(`Average match rate: ${(avgRate * 100).toFixed(1)}%`);
}
