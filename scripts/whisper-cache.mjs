#!/usr/bin/env node
// Run whisper-1 transcription on every track, cache raw output to
// data/whisper-cache/<id>.json so the alignment script can run offline.
// Idempotent — skips already-cached tracks. Sequential, 429-retry.

import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const AUDIO_DIR = resolve(ROOT, 'public/audio');
const CACHE_DIR = resolve(ROOT, 'data/whisper-cache');
const DATA_TS = resolve(ROOT, 'src/data.ts');
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const RETRY_SLEEP_MS = 6000;
const MAX_RETRIES = 3;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY missing');
  process.exit(1);
}
await mkdir(CACHE_DIR, { recursive: true });

function parseTracks(src) {
  const start = src.search(/export const TRACKS\s*:\s*Track\[\]\s*=\s*\[/);
  if (start < 0) return [];
  const region = src.slice(start);
  const blocks =
    region.match(/\{\s*id:\s*'[^']+'[\s\S]*?file:\s*'[^']+\.mp3'[\s\S]*?wisdom:[^\n]+\n\s*\}/g) || [];
  const out = [];
  const seen = new Set();
  for (const b of blocks) {
    const id = b.match(/id:\s*'([^']+)'/)?.[1];
    const file = b.match(/file:\s*'([^']+\.mp3)'/)?.[1];
    if (id && file && !seen.has(id)) {
      seen.add(id);
      out.push({ id, file: file.replace(/^\//, '') });
    }
  }
  return out;
}

const src = await readFile(DATA_TS, 'utf8');
const allTracks = parseTracks(src);
const audioFiles = new Set(await readdir(AUDIO_DIR).catch(() => []));
const tracks = allTracks
  .filter(t => audioFiles.has(basename(t.file)))
  .map(t => ({ ...t, base: basename(t.file) }));

console.log(`${tracks.length} tracks found · cache dir: ${CACHE_DIR}`);

async function transcribe(track) {
  const out = resolve(CACHE_DIR, `${track.id}.json`);
  if (existsSync(out)) {
    const existing = JSON.parse(await readFile(out, 'utf8'));
    if (Array.isArray(existing.words) && existing.words.length) {
      return { status: 'skip-cached', words: existing.words.length };
    }
  }
  const mp3 = resolve(AUDIO_DIR, track.base);
  const st = await stat(mp3);
  if (st.size > MAX_FILE_BYTES) return { status: 'skip-too-large', size: st.size };

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt++;
    const buf = await readFile(mp3);
    const form = new FormData();
    form.append('file', new Blob([buf], { type: 'audio/mpeg' }), track.base);
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('timestamp_granularities[]', 'segment');
    form.append('language', 'en');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form
    });
    if (res.status === 429) {
      console.warn(`  429 on ${track.id} (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, RETRY_SLEEP_MS));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { status: 'fail', code: res.status, msg: text.slice(0, 200) };
    }
    const json = await res.json();
    await writeFile(
      out,
      JSON.stringify({
        words: json.words || [],
        segments: json.segments || [],
        duration: json.duration || 0,
        generatedAt: new Date().toISOString()
      })
    );
    return { status: 'ok', words: (json.words || []).length, dur: json.duration };
  }
  return { status: 'fail', code: 429, msg: 'retries exhausted' };
}

let ok = 0,
  skip = 0,
  fail = 0;
const failures = [];
for (let i = 0; i < tracks.length; i++) {
  const t = tracks[i];
  const tag = `[${i + 1}/${tracks.length}] ${t.id}`.padEnd(40);
  try {
    const r = await transcribe(t);
    if (r.status === 'ok') {
      ok++;
      console.log(`${tag} ✓ ${r.words} words, ${r.dur?.toFixed(1)}s`);
    } else if (r.status?.startsWith('skip')) {
      skip++;
      console.log(`${tag} — ${r.status}`);
    } else {
      fail++;
      failures.push({ id: t.id, ...r });
      console.error(`${tag} ✗ ${r.code} ${r.msg}`);
    }
  } catch (err) {
    fail++;
    failures.push({ id: t.id, msg: err?.message || String(err) });
    console.error(`${tag} ✗ ${err?.message || err}`);
  }
}
console.log(`\n${ok} transcribed · ${skip} cached · ${fail} failed`);
if (failures.length) {
  console.log('failures:');
  for (const f of failures) console.log(`  ${f.id}: ${f.msg || f.code}`);
  process.exit(1);
}
