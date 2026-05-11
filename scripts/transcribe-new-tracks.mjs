import { readFileSync, writeFileSync } from 'fs';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ROOT = '/Users/apple/emdash-projects/worktrees/blue-donuts-flash-v6d';

const targets = [
  { id: 'banyan-ember-light', file: 'public/audio/Banyan_Ember_Light.mp3', lang: 'en' },
  { id: 'birch-swing-heaven', file: 'public/audio/Birch_Swing_Heaven.mp3', lang: 'en' },
  { id: 'brick-city-near',    file: 'public/audio/Brick_City_Near.mp3',    lang: 'en' },
  { id: 'homoousios-stone',   file: 'public/audio/Homoousios_Stone.mp3',   lang: 'en' },
  { id: 'sky-been-knocking',  file: 'public/audio/Sky_Been_Knocking.mp3',  lang: 'en' },
  { id: 'terms-updated',      file: 'public/audio/Terms_Updated.mp3',      lang: 'en' },
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

  process.stdout.write(`Transcribing ${t.id}...`);
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
  // Print first 5 lines for vibe generation
  console.log(` ✓ ${words.length} words`);
  console.log('  preview:', lines.slice(0, 4).map(l => l.text).join(' | '));
}
console.log('done');
