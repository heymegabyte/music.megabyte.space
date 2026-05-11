import { readFileSync, writeFileSync } from 'fs';

const OPENAI_API_KEY = process.env.OPENAI_KEY;
const ROOT = '/Users/apple/emdash-projects/worktrees/blue-donuts-flash-v6d';

const targets = [
  { id: 'chimba-precisa', file: 'public/audio/Chimba_Precisa.mp3', lang: 'es' },
  { id: 'soupe-saint-jean', file: 'public/audio/Soupe_Saint-Jean.mp3', lang: 'fr' },
  { id: 'corozon-gringo', file: 'public/audio/Corozon_Gringo.mp3', lang: 'es' },
];

function packLines(words, maxWords = 7, maxGap = 1.2) {
  const lines = [];
  let cur = [];
  for (const w of words) {
    if (cur.length === 0) { cur.push(w); continue; }
    const gap = w.s - cur[cur.length - 1].e;
    if (cur.length >= maxWords || gap > maxGap) {
      lines.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map(x => x.w).join(' ') });
      cur = [w];
    } else {
      cur.push(w);
    }
  }
  if (cur.length > 0) lines.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map(x => x.w).join(' ') });
  return lines;
}

for (const t of targets) {
  const buf = readFileSync(`${ROOT}/${t.file}`);
  const blob = new Blob([buf], { type: 'audio/mpeg' });
  const form = new FormData();
  form.append('file', blob, t.file.split('/').pop());
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('language', t.lang);

  process.stdout.write(`Transcribing ${t.id} (${t.lang})...`);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const json = await res.json();
  if (!res.ok) { console.log(` ERROR: ${JSON.stringify(json)}`); continue; }

  const words = (json.words || []).map(w => ({ w: String(w.word).trim(), s: w.start, e: w.end })).filter(w => w.w);
  const lines = packLines(words);
  writeFileSync(
    `${ROOT}/public/lyrics/${t.id}.json`,
    JSON.stringify({ words, lines, duration: json.duration ?? 0, source: 'whisper' }, null, 2)
  );
  console.log(` ${words.length} words, ${lines.length} lines`);
}
console.log('done');
