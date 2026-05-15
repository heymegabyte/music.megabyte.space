import { describe, expect, it } from 'vitest';
import { activeLineIndex, parseLrc, scaleStaticBundle, type LyricsBundle } from './lyrics';

describe('parseLrc', () => {
  it('parses standard [mm:ss.xx] timestamps', () => {
    const lines = parseLrc('[00:01.50]Hello\n[00:03.25]World');
    expect(lines).toEqual([
      { t: 1.5, text: 'Hello' },
      { t: 3.25, text: 'World' }
    ]);
  });

  it('parses [mm:ss] without sub-seconds', () => {
    const lines = parseLrc('[01:30]Verse one');
    expect(lines).toEqual([{ t: 90, text: 'Verse one' }]);
  });

  it('parses colon-separated sub-seconds', () => {
    const lines = parseLrc('[00:02:500]Mercy');
    expect(lines[0].t).toBeCloseTo(2.5, 5);
  });

  it('handles 1-digit and 3-digit precision', () => {
    expect(parseLrc('[00:00.5]Half')[0].t).toBeCloseTo(0.5, 5);
    expect(parseLrc('[00:00.500]Half')[0].t).toBeCloseTo(0.5, 5);
    expect(parseLrc('[00:00.005]Tiny')[0].t).toBeCloseTo(0.005, 5);
  });

  it('expands multi-timestamp lines into separate entries', () => {
    const lines = parseLrc('[00:01.00][00:21.00][00:41.00]Refrain');
    expect(lines).toEqual([
      { t: 1, text: 'Refrain' },
      { t: 21, text: 'Refrain' },
      { t: 41, text: 'Refrain' }
    ]);
  });

  it('sorts entries by time across the whole input', () => {
    const lines = parseLrc('[00:10.00]B\n[00:05.00]A\n[00:15.00]C');
    expect(lines.map(l => l.text)).toEqual(['A', 'B', 'C']);
  });

  it('drops malformed and empty lines', () => {
    const lines = parseLrc('not-a-stamp\n[bad]still-bad\n\n[00:01.00]Real');
    expect(lines).toEqual([{ t: 1, text: 'Real' }]);
  });

  it('drops timestamp groups with no text', () => {
    expect(parseLrc('[00:01.00]')).toEqual([]);
    expect(parseLrc('[00:01.00]   ')).toEqual([]);
  });

  it('returns [] for empty input', () => {
    expect(parseLrc('')).toEqual([]);
    expect(parseLrc('\n\n\n')).toEqual([]);
  });

  it('handles Windows line endings', () => {
    const lines = parseLrc('[00:01.00]A\r\n[00:02.00]B');
    expect(lines).toHaveLength(2);
    expect(lines[1].text).toBe('B');
  });
});

describe('activeLineIndex', () => {
  const lines = [
    { t: 0, text: 'a' },
    { t: 5, text: 'b' },
    { t: 10, text: 'c' },
    { t: 20, text: 'd' }
  ];

  it('returns -1 for empty arrays', () => {
    expect(activeLineIndex([], 0)).toBe(-1);
    expect(activeLineIndex([], 99)).toBe(-1);
  });

  it('returns -1 before the first timestamp', () => {
    expect(activeLineIndex([{ t: 5, text: 'a' }], 0)).toBe(-1);
    expect(activeLineIndex([{ t: 5, text: 'a' }], 4.999)).toBe(-1);
  });

  it('returns the index of the active line', () => {
    expect(activeLineIndex(lines, 0)).toBe(0);
    expect(activeLineIndex(lines, 4)).toBe(0);
    expect(activeLineIndex(lines, 5)).toBe(1);
    expect(activeLineIndex(lines, 9.99)).toBe(1);
    expect(activeLineIndex(lines, 10)).toBe(2);
    expect(activeLineIndex(lines, 15)).toBe(2);
    expect(activeLineIndex(lines, 20)).toBe(3);
  });

  it('clamps past the last timestamp', () => {
    expect(activeLineIndex(lines, 9999)).toBe(3);
  });

  it('treats exact-stamp ties as the matching line (<=)', () => {
    expect(activeLineIndex(lines, 5)).toBe(1);
  });
});

describe('scaleStaticBundle', () => {
  const staticBundle: LyricsBundle = {
    trackId: 't',
    source: 'static',
    lines: [
      { t: 0, text: 'a' },
      { t: 50, text: 'b' },
      { t: 100, text: 'c' },
      { t: 150, text: 'd' }
    ]
  };

  it('rescales fake stamps to fit the audio duration', () => {
    const out = scaleStaticBundle(staticBundle, 100);
    expect(out).toHaveLength(4);
    expect(out[0].t).toBeCloseTo(4, 5);
    expect(out[3].t).toBeCloseTo(96, 5);
    expect(out[1].t).toBeGreaterThan(out[0].t);
    expect(out[2].t).toBeGreaterThan(out[1].t);
  });

  it('preserves text', () => {
    const out = scaleStaticBundle(staticBundle, 100);
    expect(out.map(l => l.text)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('is a no-op for non-static bundles', () => {
    const lrc: LyricsBundle = { ...staticBundle, source: 'lrc' };
    expect(scaleStaticBundle(lrc, 100)).toBe(lrc.lines);
  });

  it('is a no-op for empty / invalid durations', () => {
    expect(scaleStaticBundle(staticBundle, 0)).toBe(staticBundle.lines);
    expect(scaleStaticBundle(staticBundle, -1)).toBe(staticBundle.lines);
    expect(scaleStaticBundle(staticBundle, Number.NaN)).toBe(staticBundle.lines);
    expect(scaleStaticBundle(staticBundle, Number.POSITIVE_INFINITY)).toBe(staticBundle.lines);
  });

  it('returns empty lines unchanged', () => {
    const empty: LyricsBundle = { trackId: 't', source: 'static', lines: [] };
    expect(scaleStaticBundle(empty, 100)).toEqual([]);
  });
});
