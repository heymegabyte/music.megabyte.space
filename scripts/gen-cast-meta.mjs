#!/usr/bin/env node
// Generate public/cast-meta.json — a compact { id: { bpm, key } } map distilled
// from src/suno-meta.ts. The cast receiver fetches this (~2kB) to show BPM + key
// chips in the standalone ?test preview and as a fallback when a sender omits
// them. Keeps the TV receiver bundle tiny (no 1500-line SUNO_META import).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/suno-meta.ts'), 'utf8');

// Locate each entry by its id-line, then slice to the next id to scope the
// sunoBpm/sunoKey lookups to that entry only.
const idRe = /\n {2}'([a-z0-9-]+)':\s*\{/g;
const marks = [];
for (let m; (m = idRe.exec(src)); ) marks.push({ id: m[1], at: m.index });

const out = {};
for (let i = 0; i < marks.length; i++) {
  const chunk = src.slice(marks[i].at, marks[i + 1]?.at ?? src.length);
  const bpm = chunk.match(/sunoBpm:\s*([0-9]+(?:\.[0-9]+)?)/);
  const key = chunk.match(/sunoKey:\s*'([^']*)'/);
  const entry = {};
  if (bpm) entry.bpm = Math.round(parseFloat(bpm[1]));
  if (key && key[1]) entry.key = key[1];
  if (entry.bpm || entry.key) out[marks[i].id] = entry;
}

writeFileSync(join(root, 'public/cast-meta.json'), JSON.stringify(out));
const withBpm = Object.values(out).filter(e => e.bpm).length;
const withKey = Object.values(out).filter(e => e.key).length;
console.log(`✓ cast-meta.json — ${Object.keys(out).length} tracks (${withBpm} bpm, ${withKey} key)`);
