#!/usr/bin/env node
/**
 * ingest-suno-downloads.mjs — the completion half of the Suno media loop. Scans
 * ~/Downloads for the files the Computer-Use flow pulls per song (WAV + video mp4
 * + stems/MIDI zip), matches each to a track by NORMALIZED TITLE, moves them into
 * public/media/, and flips that song's status in data/suno-download-queue.json.
 *
 *   node scripts/ingest-suno-downloads.mjs            # move matched files + update queue
 *   node scripts/ingest-suno-downloads.mjs --dry      # report only
 *
 * Suno download names are the song TITLE (e.g. "Soupe Saint-Jean.wav",
 * "Soupe Saint-Jean.mp4", "<Title> ... .zip" for the stems/MIDI bundle). Titles
 * are unique enough; on a tie the loop already picked the duration-matched clip.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync
} from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DL = resolve(homedir(), 'Downloads');
const MEDIA = resolve(ROOT, 'public/media');
const STEMS = resolve(MEDIA, 'stems');
const QF = resolve(ROOT, 'data/suno-download-queue.json');
const DRY = process.argv.includes('--dry');

const norm = s =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]/g, '');
const q = JSON.parse(readFileSync(QF, 'utf8'));
// longest-title-first so "mama called us" wins over a substring collision
const byTitle = [...q.queue].sort((a, b) => b.title.length - a.title.length);

mkdirSync(STEMS, { recursive: true });
const files = existsSync(DL) ? readdirSync(DL).filter(f => /\.(wav|mp4|mid|midi|zip)$/i.test(f)) : [];
let moved = 0;
const touched = new Set();
for (const f of files) {
  const nf = norm(f);
  const hit = byTitle.find(t => nf.includes(norm(t.title)));
  if (!hit) continue;
  const ext = extname(f).toLowerCase().replace('.midi', '.mid');
  const isZip = ext === '.zip';
  const dest = isZip ? resolve(STEMS, `${hit.trackId}.zip`) : resolve(MEDIA, `${hit.trackId}${ext}`);
  console.log(
    `${DRY ? '[dry] ' : ''}${f}  →  ${dest.replace(ROOT + '/', '')}  (${(statSync(resolve(DL, f)).size / 1e6).toFixed(1)}MB)`
  );
  if (!DRY) renameSync(resolve(DL, f), dest);
  moved++;
  touched.add(hit.trackId);
}
// recompute each touched song's status from what's now present
for (const t of q.queue) {
  const wav = existsSync(resolve(MEDIA, `${t.trackId}.wav`));
  const mp4 = existsSync(resolve(MEDIA, `${t.trackId}.mp4`));
  const zip =
    existsSync(resolve(STEMS, `${t.trackId}.zip`)) || existsSync(resolve(MEDIA, `${t.trackId}.mid`));
  t.status =
    wav && mp4 && zip
      ? 'done'
      : wav || mp4 || zip
        ? `partial:${[wav && 'wav', zip && 'stems', mp4 && 'video'].filter(Boolean).join('+')}`
        : t.status;
}
if (!DRY) writeFileSync(QF, JSON.stringify(q, null, 2));
const done = q.queue.filter(t => t.status === 'done').length;
console.log(
  `\ningest: ${moved} files ${DRY ? 'would move' : 'moved'} · ${done}/${q.queue.length} songs complete (wav+stems+video)`
);
