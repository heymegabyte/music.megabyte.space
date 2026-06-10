// Album-art palette extraction. Two-pass: (1) RGB cube bucket for fast dominant
// detection, (2) HSL classification into semantic roles (vibrant/muted/dark/light)
// inspired by Color Thief v3 + Vibrant.js. Emits sRGB hex + OKLCH strings +
// Display P3 color() strings so every viz/Hue/CSS surface gets the richest
// gamut the device supports.

export type RGB = [number, number, number];

export interface Palette {
  // dominant population (preserves prior API — main.ts + hue.ts read these)
  swatches: string[]; // hex, 5 entries, dominant first
  rgb: RGB[]; // matches swatches
  accent: string; // hex of vibrant
  vibrant: RGB;
  muted: RGB;
  ink: '#ffffff' | '#0b0d12';

  // semantic roles (new — every visualizer mode reads these)
  darkVibrant: RGB;
  lightMuted: RGB;
  complementary: RGB;
  vibrantHex: string;
  mutedHex: string;
  darkVibrantHex: string;
  lightMutedHex: string;
  complementaryHex: string;

  // OKLCH outputs (perceptually uniform, drive CSS lerps + AI palette tweaks)
  vibrantOklch: string; // 'oklch(L C h)'
  mutedOklch: string;
  darkVibrantOklch: string;
  lightMutedOklch: string;
  accentOklch: string; // === vibrantOklch
  swatchesOklch: string[];

  // Display P3 outputs (~50% more saturation on supported devices)
  vibrantP3: string; // 'color(display-p3 r g b)'
  mutedP3: string;
  accentP3: string;
  swatchesP3: string[];

  // metadata
  contrast: number; // WCAG ratio of vibrant vs ink
  warmth: number; // -1 cool → +1 warm
  meanLum: number; // 0-255
}

const cache = new Map<string, Palette>();

export async function extractPalette(src: string): Promise<Palette> {
  const cached = cache.get(src);
  if (cached) return cached;
  const img = await loadImage(src);
  const palette = computePalette(img);
  cache.set(src, palette);
  return palette;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`palette: failed to load ${src}`));
    img.src = src;
  });
}

function computePalette(img: HTMLImageElement): Palette {
  const size = 96;
  const cnv = document.createElement('canvas');
  cnv.width = size;
  cnv.height = size;
  const ctx = cnv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fallback();
  ctx.drawImage(img, 0, 0, size, size);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return fallback();
  }

  // Pass 1 — RGB cube buckets for dominance.
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let lumSum = 0,
    lumCount = 0,
    warmSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumSum += lum;
    lumCount++;
    warmSum += r - b;
    if (lum < 14 || lum > 250) continue;
    const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const prev = buckets.get(key);
    if (prev) {
      prev.r += r;
      prev.g += g;
      prev.b += b;
      prev.n += 1;
    } else buckets.set(key, { r, g, b, n: 1 });
  }
  if (buckets.size === 0) return fallback();

  const sorted = [...buckets.values()]
    .map(b => ({ r: Math.round(b.r / b.n), g: Math.round(b.g / b.n), b: Math.round(b.b / b.n), n: b.n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 24);

  // De-dupe perceptually similar entries.
  const dedup: typeof sorted = [];
  for (const s of sorted) {
    if (dedup.every(d => colorDist(d, s) > 22)) dedup.push(s);
    if (dedup.length >= 8) break;
  }
  while (dedup.length < 5) dedup.push(dedup[dedup.length - 1] || { r: 22, g: 26, b: 38, n: 1 });

  const rgb: RGB[] = dedup.slice(0, 5).map(d => [d.r, d.g, d.b]);

  // Pass 2 — semantic classification across the full candidate pool (up to 8).
  const candidates = dedup.map(c => {
    const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
    return { rgb: [c.r, c.g, c.b] as RGB, n: c.n, h, s, l };
  });
  const vibrant = pickRole(candidates, c => roleScore(c, 'vibrant'));
  const muted = pickRole(candidates, c => roleScore(c, 'muted'));
  const darkVibrant = pickRole(candidates, c => roleScore(c, 'darkVibrant'));
  const lightMuted = pickRole(candidates, c => roleScore(c, 'lightMuted'));
  const complementary = complementOf(vibrant);

  const meanLum = lumCount ? lumSum / lumCount : 90;
  const warmth = lumCount ? Math.max(-1, Math.min(1, warmSum / lumCount / 80)) : 0;
  const ink: '#ffffff' | '#0b0d12' = lumOf(rgb[0]) > 140 ? '#0b0d12' : '#ffffff';
  const contrast = wcagContrast(vibrant, ink === '#ffffff' ? [255, 255, 255] : [11, 13, 18]);

  const swatchesOklch = rgb.map(rgbToOklch);
  const swatchesP3 = rgb.map(rgbToP3);

  return {
    swatches: rgb.map(toHex),
    rgb,
    accent: toHex(vibrant),
    vibrant,
    muted,
    ink,
    darkVibrant,
    lightMuted,
    complementary,
    vibrantHex: toHex(vibrant),
    mutedHex: toHex(muted),
    darkVibrantHex: toHex(darkVibrant),
    lightMutedHex: toHex(lightMuted),
    complementaryHex: toHex(complementary),
    vibrantOklch: rgbToOklch(vibrant),
    mutedOklch: rgbToOklch(muted),
    darkVibrantOklch: rgbToOklch(darkVibrant),
    lightMutedOklch: rgbToOklch(lightMuted),
    accentOklch: rgbToOklch(vibrant),
    swatchesOklch,
    vibrantP3: rgbToP3(vibrant),
    mutedP3: rgbToP3(muted),
    accentP3: rgbToP3(vibrant),
    swatchesP3,
    contrast,
    warmth,
    meanLum
  };
}

function fallback(): Palette {
  const rgb: RGB[] = [
    [13, 16, 24],
    [23, 27, 41],
    [12, 26, 42],
    [28, 39, 72],
    [12, 15, 23]
  ];
  const vibrant: RGB = [0, 229, 255];
  const muted: RGB = [50, 60, 80];
  const darkVibrant: RGB = [10, 70, 90];
  const lightMuted: RGB = [150, 170, 190];
  const complementary: RGB = [255, 90, 60];
  return {
    swatches: rgb.map(toHex),
    rgb,
    accent: toHex(vibrant),
    vibrant,
    muted,
    ink: '#ffffff',
    darkVibrant,
    lightMuted,
    complementary,
    vibrantHex: toHex(vibrant),
    mutedHex: toHex(muted),
    darkVibrantHex: toHex(darkVibrant),
    lightMutedHex: toHex(lightMuted),
    complementaryHex: toHex(complementary),
    vibrantOklch: rgbToOklch(vibrant),
    mutedOklch: rgbToOklch(muted),
    darkVibrantOklch: rgbToOklch(darkVibrant),
    lightMutedOklch: rgbToOklch(lightMuted),
    accentOklch: rgbToOklch(vibrant),
    swatchesOklch: rgb.map(rgbToOklch),
    vibrantP3: rgbToP3(vibrant),
    mutedP3: rgbToP3(muted),
    accentP3: rgbToP3(vibrant),
    swatchesP3: rgb.map(rgbToP3),
    contrast: 7.2,
    warmth: -0.1,
    meanLum: 18
  };
}

interface Candidate {
  rgb: RGB;
  n: number;
  h: number;
  s: number;
  l: number;
}
type RoleName = 'vibrant' | 'muted' | 'darkVibrant' | 'lightMuted';

// Vibrant.js-inspired target ranges (L=lightness 0-1, S=saturation 0-1).
const TARGETS: Record<
  RoleName,
  { L: number; S: number; minS?: number; maxS?: number; minL?: number; maxL?: number }
> = {
  vibrant: { L: 0.5, S: 1.0, minS: 0.35, minL: 0.3, maxL: 0.7 },
  muted: { L: 0.5, S: 0.3, maxS: 0.4, minL: 0.3, maxL: 0.7 },
  darkVibrant: { L: 0.26, S: 1.0, minS: 0.35, maxL: 0.45 },
  lightMuted: { L: 0.74, S: 0.3, maxS: 0.4, minL: 0.55 }
};

function roleScore(c: Candidate, role: RoleName): number {
  const t = TARGETS[role];
  if (t.minS !== undefined && c.s < t.minS) return -1;
  if (t.maxS !== undefined && c.s > t.maxS) return -1;
  if (t.minL !== undefined && c.l < t.minL) return -1;
  if (t.maxL !== undefined && c.l > t.maxL) return -1;
  const distL = Math.abs(c.l - t.L);
  const distS = Math.abs(c.s - t.S);
  // Weighted: hit target L+S closely, prefer larger populations.
  return (1 - distL) * 3 + (1 - distS) * 3 + Math.min(1, c.n / 800);
}

function pickRole(cands: Candidate[], scorer: (c: Candidate) => number): RGB {
  let best = cands[0];
  let bestScore = scorer(cands[0]);
  for (let i = 1; i < cands.length; i++) {
    const s = scorer(cands[i]);
    if (s > bestScore) {
      bestScore = s;
      best = cands[i];
    }
  }
  // Fallback when nothing meets the role thresholds → most-populated candidate.
  return bestScore > 0 ? best.rgb : cands[0].rgb;
}

function complementOf(c: RGB): RGB {
  const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
  const ch = (h + 180) % 360;
  return hslToRgb(ch, Math.max(s, 0.4), Math.min(0.65, Math.max(0.4, l)));
}

function colorDist(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  const dr = a.r - b.r,
    dg = a.g - b.g,
    db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function lumOf(c: RGB): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  const max = Math.max(R, G, B),
    min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case R:
        h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
        break;
      case G:
        h = ((B - R) / d + 2) * 60;
        break;
      default:
        h = ((R - G) / d + 4) * 60;
        break;
    }
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const H = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(p, q, H + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, H) * 255),
    Math.round(hue2rgb(p, q, H - 1 / 3) * 255)
  ];
}

function wcagContrast(a: RGB, b: RGB): number {
  const L = (c: RGB) => {
    const lin = c.map(v => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const la = L(a),
    lb = L(b);
  const lo = Math.min(la, lb),
    hi = Math.max(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// sRGB → linear → XYZ (D65) → OKLab → OKLCH. Reference: Björn Ottosson 2020.
function rgbToOklch(c: RGB): string {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const r = lin(c[0]),
    g = lin(c[1]),
    b = lin(c[2]);
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.sqrt(a * a + b2 * b2);
  let h = (Math.atan2(b2, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return `oklch(${L.toFixed(4)} ${C.toFixed(4)} ${h.toFixed(2)})`;
}

// sRGB → Display P3 via gamut-mapped linear RGB → P3 primaries.
function rgbToP3(c: RGB): string {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const r = lin(c[0]),
    g = lin(c[1]),
    b = lin(c[2]);
  // sRGB linear → XYZ
  const X = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  // XYZ → P3 linear
  const pr = 2.4934969 * X - 0.9313836 * Y - 0.4027108 * Z;
  const pg = -0.8294889 * X + 1.7626641 * Y + 0.0236247 * Z;
  const pb = 0.0358458 * X - 0.0761724 * Y + 0.9568845 * Z;
  // P3 linear → P3 gamma
  const gam = (v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  };
  return `color(display-p3 ${gam(pr).toFixed(4)} ${gam(pg).toFixed(4)} ${gam(pb).toFixed(4)})`;
}

export function toHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function rgbToXY(r: number, g: number, b: number): [number, number] {
  // sRGB (D65) → CIE xy for Hue API. Gamma-corrected per Hue developer docs.
  const norm = (c: number) => {
    const v = c / 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  };
  const R = norm(r),
    G = norm(g),
    B = norm(b);
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;
  const sum = X + Y + Z;
  if (sum === 0) return [0.3127, 0.329];
  return [X / sum, Y / sum];
}

export function rgbBrightness(r: number, g: number, b: number): number {
  // 0-1 perceptual brightness for Hue dim level.
  return Math.min(1, Math.max(0.04, (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255));
}
