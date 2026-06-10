import { describe, it, expect } from 'vitest';
import { fmtTime, fmtClock, fmtHz, hzToNote } from './format';

describe('fmtTime', () => {
  it('formats whole minutes + zero-padded seconds', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(5)).toBe('0:05');
    expect(fmtTime(65)).toBe('1:05');
    expect(fmtTime(600)).toBe('10:00');
  });

  it('floors fractional seconds (never rounds up a partial second)', () => {
    expect(fmtTime(90.9)).toBe('1:30');
    expect(fmtTime(59.999)).toBe('0:59');
  });

  it('handles durations past an hour as plain minutes', () => {
    expect(fmtTime(3661)).toBe('61:01');
  });

  it('clamps negatives and non-finite input to 0:00', () => {
    expect(fmtTime(-1)).toBe('0:00');
    expect(fmtTime(Number.NaN)).toBe('0:00');
    expect(fmtTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });

  it('fmtClock is the same function (alias)', () => {
    expect(fmtClock).toBe(fmtTime);
    expect(fmtClock(125)).toBe('2:05');
  });
});

describe('fmtHz', () => {
  it('shows whole hertz below 1 kHz, rounded', () => {
    expect(fmtHz(440)).toBe('440 Hz');
    expect(fmtHz(999)).toBe('999 Hz');
    expect(fmtHz(440.4)).toBe('440 Hz');
    expect(fmtHz(440.6)).toBe('441 Hz');
  });

  it('switches to kHz with 2 decimals at and above 1000', () => {
    expect(fmtHz(1000)).toBe('1.00 kHz');
    expect(fmtHz(1200)).toBe('1.20 kHz');
    expect(fmtHz(20000)).toBe('20.00 kHz');
  });

  it('returns the em-dash placeholder for invalid input', () => {
    expect(fmtHz(0)).toBe('— Hz');
    expect(fmtHz(-5)).toBe('— Hz');
    expect(fmtHz(Number.NaN)).toBe('— Hz');
    expect(fmtHz(Number.POSITIVE_INFINITY)).toBe('— Hz');
  });
});

describe('hzToNote', () => {
  it('maps reference frequencies to equal-tempered note names (A4 = 440)', () => {
    expect(hzToNote(440)).toBe('A4');
    expect(hzToNote(261.63)).toBe('C4'); // middle C
    expect(hzToNote(880)).toBe('A5'); // octave up
    expect(hzToNote(27.5)).toBe('A0'); // lowest piano key
  });

  it('snaps slightly-detuned input to the nearest note', () => {
    expect(hzToNote(441)).toBe('A4');
    expect(hzToNote(438)).toBe('A4');
  });

  it('returns the em-dash placeholder at or below the 20 Hz floor + non-finite', () => {
    expect(hzToNote(20)).toBe('—');
    expect(hzToNote(0)).toBe('—');
    expect(hzToNote(Number.NaN)).toBe('—');
    expect(hzToNote(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('uses sharps for the accidental notes', () => {
    expect(hzToNote(466.16)).toBe('A♯4');
  });
});
