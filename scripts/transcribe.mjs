#!/usr/bin/env node
// Whisper word-level transcription for every MP3.
// Outputs public/lyrics/<id>.json: { words: [{ w, s, e }], lines: [{ s, e, text }] }

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const AUDIO_DIR = resolve(ROOT, 'public/audio');
const LYRICS_DIR = resolve(ROOT, 'public/lyrics');
const DATA_TS = resolve(ROOT, 'src/data.ts');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY missing');
  process.exit(1);
}

await mkdir(LYRICS_DIR, { recursive: true });

const dataSource = await readFile(DATA_TS, 'utf8');
const trackBlocks = dataSource.match(/\{\s*id:\s*'[^']+'[\s\S]*?wisdom:[^\n]+\n\s*\}/g) || [];
const tracks = trackBlocks
  .map(b => {
    const id = b.match(/id:\s*'([^']+)'/)?.[1];
    const file = b.match(/file:\s*'([^']+)'/)?.[1];
    return id && file ? { id, file: file.replace(/^\//, '') } : null;
  })
  .filter(Boolean);

console.log(`Found ${tracks.length} tracks to transcribe`);

function packLines(words, maxWordsPerLine = 7, maxGap = 1.2) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    if (!cur.length) {
      cur.push(w);
      continue;
    }
    const prev = cur[cur.length - 1];
    const gap = w.s - prev.e;
    if (cur.length >= maxWordsPerLine || gap > maxGap) {
      lines.push(toLine(cur));
      cur = [w];
    } else {
      cur.push(w);
    }
  }
  if (cur.length) lines.push(toLine(cur));
  return lines;
}
function toLine(ws) {
  return { s: ws[0].s, e: ws[ws.length - 1].e, text: ws.map(w => w.w).join(' ') };
}

async function transcribeOne(track) {
  const out = resolve(LYRICS_DIR, `${track.id}.json`);
  if (existsSync(out)) {
    console.log(`✓ ${track.id} (cached)`);
    return;
  }
  const mp3Path = resolve(ROOT, 'public', track.file);
  if (!existsSync(mp3Path)) {
    console.warn(`✗ ${track.id} → mp3 missing: ${mp3Path}`);
    return;
  }
  const buf = await readFile(mp3Path);
  const blob = new Blob([buf], { type: 'audio/mpeg' });
  const form = new FormData();
  form.append('file', blob, mp3Path.split('/').pop());
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('language', 'en');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`✗ ${track.id} → ${res.status} ${text.slice(0, 200)}`);
    return;
  }
  const json = await res.json();
  const words = (json.words || [])
    .map(w => ({
      w: String(w.word || '').trim(),
      s: Number(w.start ?? 0),
      e: Number(w.end ?? 0)
    }))
    .filter(w => w.w.length);
  const lines = packLines(words);
  await writeFile(out, JSON.stringify({ words, lines, duration: json.duration ?? 0 }));
  console.log(`✓ ${track.id} (${words.length} words, ${lines.length} lines)`);
}

const concurrency = 4;
let i = 0;
async function worker() {
  while (i < tracks.length) {
    const t = tracks[i++];
    try {
      await transcribeOne(t);
    } catch (err) {
      console.error(`✗ ${t.id} → ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.log('done');
