// LRC synced-lyrics engine. Parses [mm:ss.xx] timestamps, exposes a tick(currentTime)
// method that returns the active line index. Falls back to static Track.lyrics[].

import type { Track } from './types';

export interface SyncedLine {
  t: number;       // start time in seconds
  text: string;
}

export interface LyricsBundle {
  trackId: string;
  lines: SyncedLine[];
  source: 'lrc' | 'static' | 'empty';
}

const cache = new Map<string, LyricsBundle>();

export async function loadLyrics(track: Track): Promise<LyricsBundle> {
  const cached = cache.get(track.id);
  if (cached) return cached;
  const bundle = await fetchLrc(track).catch(() => null);
  const final = bundle ?? staticBundle(track);
  cache.set(track.id, final);
  return final;
}

async function fetchLrc(track: Track): Promise<LyricsBundle | null> {
  const url = `/lyrics/${track.id}.lrc`;
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) return null;
  const text = await res.text();
  const lines = parseLrc(text);
  if (!lines.length) return null;
  return { trackId: track.id, lines, source: 'lrc' };
}

function staticBundle(track: Track): LyricsBundle {
  if (!track.lyrics?.length) return { trackId: track.id, lines: [], source: 'empty' };
  // No timestamps available — distribute evenly so the karaoke effect still flows.
  const lines = track.lyrics.map((text, i, arr) => ({
    t: (i / Math.max(1, arr.length)) * 200, // fake spread; tickWith() rescales by duration
    text
  }));
  return { trackId: track.id, lines, source: 'static' };
}

const LRC_RE = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/;

export function parseLrc(text: string): SyncedLine[] {
  const out: SyncedLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // A single line may carry multiple timestamps "[00:01.00][00:21.00]text"
    const stamps: number[] = [];
    let rest = line;
    while (true) {
      const m = rest.match(LRC_RE);
      if (!m) break;
      const mm = parseInt(m[1], 10);
      const ss = parseInt(m[2], 10);
      const cs = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) / 1000 : 0;
      const t = mm * 60 + ss + cs;
      stamps.push(t);
      rest = m[4];
      // Continue eating leading [..] groups
      if (!/^\[/.test(rest)) break;
    }
    const cleaned = rest.trim();
    if (!cleaned || stamps.length === 0) continue;
    for (const t of stamps) out.push({ t, text: cleaned });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Active line index given current playback position (seconds). Returns -1 before first stamp. */
export function activeLineIndex(lines: SyncedLine[], time: number): number {
  if (!lines.length) return -1;
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= time) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

/** For static (no-timestamp) bundles, scale fake stamps to fit current duration. */
export function scaleStaticBundle(bundle: LyricsBundle, duration: number): SyncedLine[] {
  if (bundle.source !== 'static' || !bundle.lines.length || !Number.isFinite(duration) || duration <= 0) return bundle.lines;
  const n = bundle.lines.length;
  const span = duration * 0.92; // leave a tail
  const start = duration * 0.04;
  return bundle.lines.map((l, i) => ({ t: start + (i / Math.max(1, n - 1)) * span, text: l.text }));
}
