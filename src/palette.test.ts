import { describe, it, expect } from 'vitest';
import { toHex, rgbToXY, rgbBrightness } from './palette';

describe('toHex', () => {
  it('formats primaries and extremes', () => {
    expect(toHex([0, 0, 0])).toBe('#000000');
    expect(toHex([255, 255, 255])).toBe('#ffffff');
    expect(toHex([255, 0, 0])).toBe('#ff0000');
  });

  it('zero-pads single hex digits', () => {
    expect(toHex([1, 2, 3])).toBe('#010203');
    expect(toHex([16, 32, 48])).toBe('#102030');
  });

  it('round-trips the brand cyan', () => {
    expect(toHex([0, 229, 255])).toBe('#00e5ff');
  });
});

describe('rgbToXY (sRGB D65 → CIE 1931 xy for the Hue API)', () => {
  it('maps white to the D65 white point', () => {
    const [x, y] = rgbToXY(255, 255, 255);
    expect(x).toBeCloseTo(0.3127, 3);
    expect(y).toBeCloseTo(0.329, 3);
  });

  it('maps pure red and green to their known Hue coordinates', () => {
    const [rx, ry] = rgbToXY(255, 0, 0);
    expect(rx).toBeCloseTo(0.64, 2);
    expect(ry).toBeCloseTo(0.33, 2);
    const [gx, gy] = rgbToXY(0, 255, 0);
    expect(gx).toBeCloseTo(0.3, 2);
    expect(gy).toBeCloseTo(0.6, 2);
  });

  it('falls back to the D65 white point for black (sum === 0)', () => {
    expect(rgbToXY(0, 0, 0)).toEqual([0.3127, 0.329]);
  });

  it('always returns coordinates inside the chromaticity unit range', () => {
    const cases: Array<[number, number, number]> = [
      [12, 200, 240],
      [255, 128, 0],
      [80, 80, 80]
    ];
    for (const [r, g, b] of cases) {
      const [x, y] = rgbToXY(r, g, b);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });
});

describe('rgbBrightness (0-1 perceptual, clamped to [0.04, 1])', () => {
  it('returns 1 for white and the luma weights for primaries', () => {
    expect(rgbBrightness(255, 255, 255)).toBeCloseTo(1, 5);
    expect(rgbBrightness(255, 0, 0)).toBeCloseTo(0.2126, 3);
    expect(rgbBrightness(0, 255, 0)).toBeCloseTo(0.7152, 3);
  });

  it('clamps near-black up to the 0.04 floor (Hue never goes fully dark)', () => {
    expect(rgbBrightness(0, 0, 0)).toBe(0.04);
    expect(rgbBrightness(1, 1, 1)).toBe(0.04);
  });

  it('keeps blue above the floor (0.0722 > 0.04)', () => {
    expect(rgbBrightness(0, 0, 255)).toBeCloseTo(0.0722, 3);
  });

  it('mid-grey is roughly half', () => {
    expect(rgbBrightness(128, 128, 128)).toBeCloseTo(0.502, 2);
  });
});
