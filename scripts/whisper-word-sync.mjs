#!/usr/bin/env node
// Word-level karaoke sync via OpenAI Whisper API.
// For each Track in src/data.ts: POST mp3 → whisper-1 verbose_json (word+segment timestamps)
// → write public/lyrics/<id>.json with { words:[{w,s,e,line}], lines:[{s,e,text}], duration, source:'whisper', generatedAt, model }.
// Idempotent: skips tracks already at source='whisper' with words[]. Sequential. Retries 429 ×3.

import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const AUDIO_DIR = resolve(ROOT, 'public/audio');
const LYRICS_DIR = resolve(ROOT, 'public/lyrics');
const DATA_TS = resolve(ROOT, 'src/data.ts');
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const RETRY_SLEEP_MS = 6000;
const MAX_RETRIES = 3;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error(
    'OPENAI_API_KEY missing — `set -a; source /Users/apple/emdash-projects/worktrees/rare-chefs-film-8op/.env.local; set +a`'
  );
  process.exit(1);
}

await mkdir(LYRICS_DIR, { recursive: true });

function parseTracks(src) {
  // Scope to the TRACKS array only (skip ALBUMS array which has nested objects without `file:` or `wisdom:`)
  const tracksStart = src.search(/export const TRACKS\s*:\s*Track\[\]\s*=\s*\[/);
  if (tracksStart < 0) return [];
  const region = src.slice(tracksStart);
  // Match each track object: requires both `file:` AND `wisdom:` to disqualify album entries.
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

const dataSource = await readFile(DATA_TS, 'utf8');
const allTracks = parseTracks(dataSource);

// Intersect with audio dir presence
const audioFiles = new Set(await readdir(AUDIO_DIR).catch(() => []));
const tracks = [];
const missingMp3 = [];
for (const t of allTracks) {
  const base = basename(t.file);
  if (audioFiles.has(base)) tracks.push({ ...t, base });
  else missingMp3.push(t.id);
}

console.log(
  `Found ${allTracks.length} tracks in data.ts → ${tracks.length} have mp3 files (${missingMp3.length} missing audio: ${missingMp3.slice(0, 5).join(', ')}${missingMp3.length > 5 ? '…' : ''})`
);

function packLinesFromSegments(segments, words) {
  const lines = [];
  let wi = 0;
  for (const seg of segments) {
    const segStart = Number(seg.start ?? 0);
    const segEnd = Number(seg.end ?? 0);
    const text = String(seg.text ?? '').trim();
    if (!text) continue;
    const lineIdx = lines.length;
    // Tag every word that falls into this segment
    const segWords = [];
    while (wi < words.length && words[wi].s < segEnd - 0.001) {
      if (words[wi].s >= segStart - 0.5) {
        words[wi].line = lineIdx;
        segWords.push(words[wi]);
      }
      wi++;
    }
    lines.push({ s: segStart, e: segEnd, text });
  }
  // Any trailing words → last line
  if (lines.length) {
    while (wi < words.length) {
      words[wi].line = lines.length - 1;
      wi++;
    }
  }
  return lines;
}

function packLinesFromWords(words, perLine = 7, maxGap = 1.2) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    if (!cur.length) {
      cur.push(w);
      continue;
    }
    const prev = cur[cur.length - 1];
    if (cur.length >= perLine || w.s - prev.e > maxGap) {
      lines.push(toLine(cur));
      cur = [w];
    } else {
      cur.push(w);
    }
  }
  if (cur.length) lines.push(toLine(cur));
  // Tag word.line indexes
  for (let i = 0; i < lines.length; i++) {
    for (const w of lines[i]._ws) w.line = i;
    delete lines[i]._ws;
  }
  return lines;
}
function toLine(ws) {
  return { s: ws[0].s, e: ws[ws.length - 1].e, text: ws.map(w => w.w).join(' '), _ws: ws };
}

async function transcribeOne(track) {
  const out = resolve(LYRICS_DIR, `${track.id}.json`);
  // Idempotent: already whisper-sourced with words[]
  if (existsSync(out)) {
    try {
      const existing = JSON.parse(await readFile(out, 'utf8'));
      if (existing.source === 'whisper' && Array.isArray(existing.words) && existing.words.length) {
        return {
          status: 'skip-cached',
          words: existing.words.length,
          lines: existing.lines?.length ?? 0,
          dur: existing.duration ?? 0
        };
      }
    } catch {
      /* fall through, regenerate */
    }
  }

  const mp3Path = resolve(AUDIO_DIR, track.base);
  if (!existsSync(mp3Path)) return { status: 'skip-no-mp3' };
  const st = await stat(mp3Path);
  if (st.size > MAX_FILE_BYTES) return { status: 'skip-too-large', size: st.size };

  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    attempt++;
    const buf = await readFile(mp3Path);
    const blob = new Blob([buf], { type: 'audio/mpeg' });
    const form = new FormData();
    form.append('file', blob, track.base);
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
      const txt = await res.text().catch(() => '');
      console.warn(
        `  429 rate-limit on ${track.id} (attempt ${attempt}/${MAX_RETRIES}) — sleeping ${RETRY_SLEEP_MS}ms · ${txt.slice(0, 120)}`
      );
      await new Promise(r => setTimeout(r, RETRY_SLEEP_MS));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { status: 'fail', code: res.status, msg: text.slice(0, 240) };
    }
    const json = await res.json();
    const rawWords = Array.isArray(json.words) ? json.words : [];
    const words = rawWords
      .map(w => ({ w: String(w.word ?? '').trim(), s: Number(w.start ?? 0), e: Number(w.end ?? 0), line: 0 }))
      .filter(w => w.w.length);
    const segments = Array.isArray(json.segments) ? json.segments : [];
    const lines = segments.length ? packLinesFromSegments(segments, words) : packLinesFromWords(words);
    const duration = Number(json.duration ?? 0);
    const payload = {
      words: words.map(w => ({ w: w.w, s: +w.s.toFixed(3), e: +w.e.toFixed(3), line: w.line | 0 })),
      lines: lines.map(l => ({ s: +Number(l.s).toFixed(3), e: +Number(l.e).toFixed(3), text: l.text })),
      duration,
      source: 'whisper',
      generatedAt: new Date().toISOString(),
      model: 'whisper-1'
    };
    await writeFile(out, JSON.stringify(payload));
    return { status: 'ok', words: words.length, lines: lines.length, dur: duration };
  }
  return { status: 'fail', code: 429, msg: 'rate limit exceeded after retries' };
}

let okCount = 0;
let skipCount = 0;
let failCount = 0;
let totalDur = 0;
const failures = [];

for (let i = 0; i < tracks.length; i++) {
  const t = tracks[i];
  const tag = `[${i + 1}/${tracks.length}] ${t.id}`.padEnd(40);
  try {
    const r = await transcribeOne(t);
    if (r.status === 'ok') {
      okCount++;
      totalDur += r.dur;
      console.log(`${tag} ✓ ${r.words} words, ${r.lines} lines, ${r.dur.toFixed(1)}s`);
    } else if (r.status === 'skip-cached') {
      skipCount++;
      totalDur += r.dur;
      console.log(`${tag} — cached (${r.words} words)`);
    } else if (r.status === 'skip-no-mp3') {
      skipCount++;
      console.log(`${tag} — skip: mp3 missing`);
    } else if (r.status === 'skip-too-large') {
      skipCount++;
      console.log(`${tag} — skip: ${(r.size / 1024 / 1024).toFixed(1)}MB > 25MB`);
    } else {
      failCount++;
      failures.push({ id: t.id, code: r.code, msg: r.msg });
      console.error(`${tag} ✗ ${r.code} ${r.msg}`);
    }
  } catch (err) {
    failCount++;
    failures.push({ id: t.id, code: 0, msg: err?.message ?? String(err) });
    console.error(`${tag} ✗ exception: ${err?.message ?? err}`);
  }
}

console.log('');
console.log(
  `Summary: ${okCount} generated · ${skipCount} skipped · ${failCount} failed · total audio ${(totalDur / 60).toFixed(1)}min`
);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(`  ${f.id}: [${f.code}] ${f.msg}`);
  process.exit(1);
}
