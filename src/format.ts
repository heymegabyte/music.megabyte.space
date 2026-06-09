// Pure formatting helpers — no DOM, no shared state, no side effects.
// Extracted from main.ts (which had its own copies) + de-duplicated against
// embed.ts and pip.ts, which each carried a byte-identical `fmtTime`. One home,
// imported everywhere, so the next tweak lands in a single place.

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;

/** Seconds → `m:ss` clock string. Negative / non-finite → `0:00`. */
export function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/** Alias kept for the now-playing HUD callsite that used `fmtClock`. */
export const fmtClock = fmtTime;

/** Frequency → human label: `440 Hz`, `1.20 kHz`, or `— Hz` when invalid. */
export function fmtHz(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '— Hz';
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
  return `${Math.round(hz)} Hz`;
}

/** Frequency → nearest equal-tempered note name + octave (A4 = 440 Hz). */
export function hzToNote(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 20) return '—';
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const oct = Math.floor(midi / 12) - 1;
  return `${name}${oct}`;
}
