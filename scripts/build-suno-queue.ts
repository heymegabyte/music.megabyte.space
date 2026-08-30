/**
 * build-suno-queue.ts — emit data/suno-download-queue.json: the ordered worklist
 * the Suno media loop walks (WAV + stems/MIDI + video, one song per iteration).
 *
 * Order = the site's canonical order (ALBUMS × album.trackIds). Each entry carries
 * the site duration (to MATCH the correct Suno clip by length, per the walkthrough)
 * + the best-known sunoId/duration from suno-matches.json + a `status` the loop flips
 * pending→done. Re-run any time; it PRESERVES existing statuses.
 *
 *   npx vite-node scripts/build-suno-queue.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALBUMS, TRACK_BY_ID, ALBUM_BY_ID } from '../src/data';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'data/suno-download-queue.json');
const durSrc = readFileSync(resolve(ROOT, 'src/durations.ts'), 'utf8');
const durBlock = durSrc.match(/TRACK_DURATIONS[^=]*=\s*\{([\s\S]*?)\n\};/)![1];
const SITE_DUR: Record<string, number> = Object.fromEntries(
  [...durBlock.matchAll(/'([^']+)':\s*(\d+)/g)].map(m => [m[1], Number(m[2])])
);
const matches = JSON.parse(readFileSync(resolve(ROOT, 'data/suno-matches.json'), 'utf8')).matches || [];
const matchById = new Map<string, any>(matches.map((m: any) => [m.id, m]));
const prev: Record<string, string> = existsSync(OUT)
  ? Object.fromEntries(
      (JSON.parse(readFileSync(OUT, 'utf8')).queue || []).map((q: any) => [q.trackId, q.status])
    )
  : {};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const queue: any[] = [];
let order = 0;
for (const album of ALBUMS) {
  for (const id of album.trackIds) {
    const t = TRACK_BY_ID.get(id);
    if (!t) continue;
    const siteSec = SITE_DUR[id] ?? null;
    const m = matchById.get(id);
    const sunoSec = m?.sunoDuration ? Math.round(m.sunoDuration) : null;
    queue.push({
      order: ++order,
      trackId: id,
      title: t.title,
      album: album.id,
      albumName: album.name,
      siteSec,
      siteMMSS: siteSec != null ? mmss(siteSec) : null,
      sunoId: m?.sunoId ?? null,
      sunoSec,
      sunoMMSS: sunoSec != null ? mmss(sunoSec) : null,
      durMatch: siteSec != null && sunoSec != null ? Math.abs(siteSec - sunoSec) <= 3 : false,
      status: prev[id] ?? 'pending' // pending | wav | stems | video | done | blocked
    });
  }
}
writeFileSync(OUT, JSON.stringify({ generated_at: null, total: queue.length, queue }, null, 2));
const pend = queue.filter(q => q.status === 'pending').length;
console.log(
  `suno-download-queue: ${queue.length} songs in site order · ${pend} pending · ${queue.length - pend} already done`
);
console.log(
  `first 3: ${queue
    .slice(0, 3)
    .map(q => `${q.order}.${q.title}(${q.siteMMSS})`)
    .join(' · ')}`
);
console.log(
  `end songs (per narration): ${
    queue
      .filter(q => /come through|only human/i.test(q.title))
      .map(q => `${q.order}.${q.title}`)
      .join(' · ') || '—'
  }`
);
