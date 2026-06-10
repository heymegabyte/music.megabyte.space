#!/usr/bin/env node
// Cleans every public/lyrics/*.json file:
//   1. Removes music-symbol artifacts: ♪ ♫ ♬ ♩ ♭ ♮ ♯ + the LRC-export "-♪ " prefix.
//   2. Capitalizes the first alphabetic character of every line so karaoke
//      headers always read like proper sentences.
//   3. Drops word entries that collapse to empty after symbol scrubbing.
//   4. Re-emits the file as compact-but-readable JSON (1-line per entry).
// Word-level start/end timestamps remain untouched so Whisper sync stays exact.

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(process.cwd(), 'public/lyrics');
const MUSIC_SYMBOLS = /[♩♪♫♬♭♮♯\u{1D15D}-\u{1D164}]/gu;

function scrubText(raw) {
  if (typeof raw !== 'string') return raw;
  let s = raw.replace(MUSIC_SYMBOLS, '');
  s = s.replace(/^[\s\-–—]*[♪♫♬♩♭♮♯]+\s*/gu, ''); // safety belt on the LRC "-♪ " prefix
  s = s.replace(/^[\s\-–—]+/u, ''); // strip orphan leading dashes left behind
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Capitalize first alphabetic character (skip punctuation/numerals)
  const m = s.match(/^([^A-Za-z]*)([a-zA-Z])(.*)$/u);
  if (m) s = `${m[1]}${m[2].toUpperCase()}${m[3]}`;
  return s;
}

function processFile(path) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  let changed = 0;

  if (Array.isArray(json.lines)) {
    json.lines = json.lines
      .map(l => {
        const before = l.text;
        const after = scrubText(before);
        if (after !== before) changed++;
        return { ...l, text: after };
      })
      .filter(l => l.text);
  }

  if (Array.isArray(json.words)) {
    const before = json.words.length;
    json.words = json.words.map(w => ({ ...w, w: w.w.replace(MUSIC_SYMBOLS, '').trim() })).filter(w => w.w);
    if (json.words.length !== before) changed += before - json.words.length;

    // Capitalize first word of each line cluster
    const seenLine = new Set();
    for (const w of json.words) {
      if (seenLine.has(w.line)) continue;
      seenLine.add(w.line);
      const m = w.w.match(/^([^A-Za-z]*)([a-zA-Z])(.*)$/u);
      if (m) w.w = `${m[1]}${m[2].toUpperCase()}${m[3]}`;
    }
  }

  writeFileSync(path, JSON.stringify(json, null, 2));
  return changed;
}

const files = readdirSync(ROOT).filter(f => f.endsWith('.json'));
let total = 0;
for (const f of files) {
  const full = join(ROOT, f);
  if (!statSync(full).isFile()) continue;
  const n = processFile(full);
  total += n;
}
console.log(`Scrubbed ${files.length} files, ${total} text mutations.`);
