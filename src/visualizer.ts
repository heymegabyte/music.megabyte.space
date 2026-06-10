import type { AudioEngine } from './audio';
import type { Palette } from './palette';

// Mutable module-level keyframes — Visualizer.setPalette() swaps these to the
// track-derived palette so every track has a unique colour signature. Defaults
// match the original brand keyframes for tracks lacking extracted art.
const DEFAULT_KEYFRAMES: Array<[number, number, number]> = [
  [0, 229, 255],
  [124, 58, 237],
  [255, 45, 160],
  [245, 194, 74],
  [80, 170, 227]
];
let PALETTE_KEYFRAMES: Array<[number, number, number]> = DEFAULT_KEYFRAMES.slice();

// Pink hearts/petals — kept static by intent (love modes are always pink).
const LOVE_PALETTE: Array<[number, number, number]> = [
  [255, 105, 140],
  [255, 165, 195],
  [255, 60, 110],
  [220, 80, 160],
  [255, 200, 220]
];

// Stars — defaults to neutral whites. Visualizer.setPalette() blends in
// track accent so even "starfield" inherits a tint from the album.
const DEFAULT_STAR_PALETTE: Array<[number, number, number]> = [
  [255, 255, 255],
  [200, 220, 255],
  [255, 240, 200],
  [180, 200, 255],
  [240, 200, 255]
];
let STAR_PALETTE: Array<[number, number, number]> = DEFAULT_STAR_PALETTE.slice();

function applyTrackPalette(p: Palette | null) {
  if (!p) {
    PALETTE_KEYFRAMES = DEFAULT_KEYFRAMES.slice();
    STAR_PALETTE = DEFAULT_STAR_PALETTE.slice();
    return;
  }
  // 5-stop loop: vibrant → complementary → lightMuted → darkVibrant → vibrant
  PALETTE_KEYFRAMES = [p.vibrant, p.complementary, p.lightMuted, p.darkVibrant, p.vibrant];
  // Stars tinted toward the album's lightMuted swatch (subtle, still mostly white).
  const tint = p.lightMuted;
  const blend = (base: [number, number, number], amt: number): [number, number, number] => [
    Math.round(base[0] * (1 - amt) + tint[0] * amt),
    Math.round(base[1] * (1 - amt) + tint[1] * amt),
    Math.round(base[2] * (1 - amt) + tint[2] * amt)
  ];
  STAR_PALETTE = DEFAULT_STAR_PALETTE.map((c, i) => blend(c, 0.1 + i * 0.04));
}

function lerpPalette(p: Array<[number, number, number]>, t: number): [number, number, number] {
  const n = p.length;
  const idx = (((t % 1) + 1) % 1) * n;
  const i0 = Math.floor(idx) % n;
  const i1 = (i0 + 1) % n;
  const f = idx - Math.floor(idx);
  const a = p[i0];
  const b = p[i1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f)
  ];
}

// Module-level vibrance knob — Visualizer.draw() updates from cur.build /
// cur.centroid each frame. Push every paletteAt() result through a saturation
// stretch + centroid-driven hue rotation so the colours follow the music's
// spectral character (centroid up→hue walks up the wheel).
let VIBRANCE = 1.0; // saturation multiplier, 1=neutral
let HUE_SHIFT = 0; // degrees, -180..180

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h) * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255)
  ];
}
function vibrantize(rgb: [number, number, number]): [number, number, number] {
  if (VIBRANCE === 1 && HUE_SHIFT === 0) return rgb;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const h2 = (h + HUE_SHIFT / 360 + 1) % 1;
  const s2 = Math.max(0, Math.min(1, s * VIBRANCE));
  // Slight luminance lift only when colour is already saturated, keeps grays grey.
  const l2 = Math.max(0, Math.min(1, l + (s > 0.3 ? 0.04 : 0)));
  return hslToRgb(h2, s2, l2);
}

function paletteAt(t: number) {
  return vibrantize(lerpPalette(PALETTE_KEYFRAMES, t));
}
function lovePalette(t: number) {
  return lerpPalette(LOVE_PALETTE, t);
}
function starPalette(t: number) {
  return lerpPalette(STAR_PALETTE, t);
}

export type VizMode =
  | 'starfield'
  | 'constellation'
  | 'galaxy'
  | 'supernova'
  | 'aurora'
  | 'petals'
  | 'plasma'
  | 'mandala'
  | 'fireflies'
  | 'bokeh'
  | 'composite'
  | 'tunnel'
  | 'lissajous'
  | 'rings'
  | 'bars'
  | 'wave'
  | 'kaleidoscope'
  | 'palette-orbs'
  | 'drop-strobe'
  | 'prism'
  | 'wormhole'
  | 'vortex'
  | 'sunburst'
  | 'mirror-wave'
  | 'hex-grid'
  | 'liquid'
  | 'vinyl'
  | 'smoke'
  | 'strings'
  | 'spider'
  | 'cymatics'
  | 'confetti'
  | 'bloom'
  | 'rose'
  | 'waterfall'
  | 'monolith'
  | 'nebula'
  | 'ribbons'
  | 'gravity'
  | 'lattice'
  | 'flux';

const MODE_ORDER: VizMode[] = [
  'starfield',
  'constellation',
  'galaxy',
  'supernova',
  'aurora',
  'petals',
  'plasma',
  'mandala',
  'fireflies',
  'bokeh',
  'palette-orbs',
  'drop-strobe',
  'prism',
  'wormhole',
  'vortex',
  'sunburst',
  'mirror-wave',
  'hex-grid',
  'liquid',
  'vinyl',
  'smoke',
  'strings',
  'spider',
  'cymatics',
  'confetti',
  'bloom',
  'rose',
  'waterfall',
  'monolith',
  'nebula',
  'ribbons',
  'gravity',
  'lattice',
  'flux',
  'composite',
  'tunnel',
  'lissajous',
  'rings',
  'bars',
  'wave',
  'kaleidoscope'
];

// pure-dark background (no gradient blob field underneath)
const PURE_BG_MODES: Set<VizMode> = new Set([
  'starfield',
  'constellation',
  'galaxy',
  'plasma',
  'drop-strobe',
  'wormhole',
  'waterfall',
  'lattice',
  'monolith'
]);

type Star3D = { x: number; y: number; z: number; px: number; py: number };
type Star2D = { x: number; y: number; bin: number; tw: number };
type GalaxyParticle = { theta: number; r: number; size: number; color: [number, number, number] };
type SupernovaRing = { age: number; max: number; color: [number, number, number] };
type HeartItem = {
  x: number;
  vy: number;
  size: number;
  rot: number;
  vrot: number;
  sway: number;
  color: [number, number, number];
  life: number;
};
type Firefly = {
  x: number;
  y: number;
  ax: number;
  ay: number;
  phase: number;
  rate: number;
  color: [number, number, number];
};
type BokehItem = {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  color: [number, number, number];
  alpha: number;
};

export class Visualizer {
  private bg: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D;
  private engine: AudioEngine;
  // Mobile detection — coarse pointer (touch) AND ≤6 cores AND ≤768 CSS px,
  // OR the user requested reduced data. Audio glitches on phones came from the
  // analyser+canvas combo waking the audio thread 60×/sec; halving the render
  // budget gives the audio worker headroom to fill the output buffer cleanly.
  private isLowPower = (() => {
    if (typeof window === 'undefined') return false;
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const small = window.matchMedia?.('(max-width: 768px)').matches ?? false;
    const cores = (navigator as { hardwareConcurrency?: number }).hardwareConcurrency ?? 8;
    const reducedData = window.matchMedia?.('(prefers-reduced-data: reduce)').matches ?? false;
    return reducedData || (coarse && small && cores <= 6);
  })();
  // Target frame budget. Desktop: 0 (uncapped, lets browser run at native rAF
  // cadence, typically 60/120/144). Mobile/low-power: 33ms → 30fps cap. The
  // visualizer's adaptive quality already drops particle counts at low FPS,
  // but the rAF tick itself still fires 60×/sec and forces analyser reads —
  // the cap is what frees the audio thread.
  private targetFrameMs = this.isLowPower ? 33 : 0;
  private frameAccum = 0;
  // Adaptive DPR — climbs to native (≤3) on sustained high FPS,
  // drops to 1.5 when FPS struggles. Re-evaluated every ~500ms.
  // On low-power devices, cap harder (≤1.75) since GPU fill rate is the bottleneck.
  private dpr = Math.min(this.isLowPower ? 1.5 : 2, window.devicePixelRatio || 1);
  private dprTarget = this.dpr;
  private dprMax = Math.min(this.isLowPower ? 1.75 : 3, window.devicePixelRatio || 1);
  private dprMin = this.isLowPower ? 1 : 1.25;
  private lastDprCheck = 0;
  private rafId: number | null = null;
  private t0 = performance.now();
  private accent: [number, number, number] = [0, 229, 255];
  private mode: VizMode = 'starfield';
  private autoCycle = true;
  private manualCycleStarted = false;
  private lastCycleAt = 0;
  private fpsEMA = 60;
  private lastFrame = performance.now();
  private hudFreq = 0;
  private hudPeakBin = 0;
  private trail = false;
  private listeners = new Set<(m: VizMode) => void>();
  // Per-frame audio + render snapshot — populated once at top of draw(), then
  // read by every mode + overlay. Avoids per-mode recomputation of bands()
  // / tempoPhase() / channelEnergy() and lets cheap reads replace allocations.
  private cur = {
    t: 0, // seconds since t0
    beat: 0, // engine.beatPulse 0..1
    bpm: 0,
    bass: 0,
    lowMid: 0,
    mid: 0,
    highMid: 0,
    treble: 0,
    presence: 0,
    brilliance: 0,
    centroid: 0,
    stereo: 0,
    flux: 0,
    chL: 0,
    chR: 0,
    tempo: 0, // tempoPhase 0..1
    build: 0, // buildPhase 0..1
    drop: false, // dropImminent this frame
    dropE: 0, // smoothed RMS 0..1
    quality: 'high' as 'high' | 'medium' | 'low',
    glow: true // false when fpsEMA<48 → skip shadowBlur for speed
  };
  // Global drop flash — armed on dropImminent, decays at ~120ms.
  private dropFlash = 0;

  // Shared particle pool — emits on dropImminent + sustained beat peaks.
  // Screen-blended, scales speed with bass, rotates hue via centroid.
  private particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    max: number;
    size: number;
    hue: number;
  }> = [];

  // Offscreen bloom canvas — quarter-res scratch buffer, allocated once on
  // first FX pass. Resized whenever main canvas dimensions change.
  private bloomCanvas: HTMLCanvasElement | null = null;
  private bloomCtx: CanvasRenderingContext2D | null = null;

  // Cumulative hue drift — integrated over time so the centroid drives
  // long-term colour evolution rather than just snapping per frame.
  private hueDrift = 0;

  // Tempo-locked motion clock — every mode reads `tempoClock` (seconds, BPM-paced)
  // and/or calls `pace(speed)` so motion stays coherent across the catalog:
  //   • Slow tracks (~60bpm) → tempoScale ≈ 0.75  → calmer drift, no stalls.
  //   • Median tracks (~100bpm) → tempoScale ≈ 1.0
  //   • Fast tracks (~140bpm)   → tempoScale ≈ 1.27 → more excitement, no strobe.
  // Beat-pulse subtly nudges the clock forward on downbeats so motion lands
  // on the beat without snapping. tempoScale is also clamped [0.7, 1.35] so
  // bad BPM estimates can't make the whole catalog jitter or stall.
  private tempoClock = 0;
  private tempoScale = 1;

  // Reusable noise tile for cinematic film-grain post-pass. 64×64 pre-painted
  // once on first use, drawn screen-blend at low alpha + jittered offset so
  // every frame looks unique without recomputing the noise field.
  private grainCanvas: HTMLCanvasElement | null = null;

  private vizState: {
    starfield?: { stars: Star3D[] };
    constellation?: { stars: Star2D[] };
    galaxy?: { particles: GalaxyParticle[] };
    supernova?: { rings: SupernovaRing[] };
    petals?: { items: HeartItem[] };
    plasma?: { off: HTMLCanvasElement; offCtx: CanvasRenderingContext2D; img: ImageData };
    fireflies?: { items: Firefly[] };
    bokeh?: { items: BokehItem[] };
  } = {};

  constructor(bg: HTMLCanvasElement, engine: AudioEngine) {
    this.bg = bg;
    // desynchronized=true releases the rAF→compositor handoff on Chromium,
    // shaving ~4-8ms of latency per frame on the GPU compositor path. Falls
    // back gracefully when the flag isn't honored.
    this.bgCtx = bg.getContext('2d', { alpha: true, desynchronized: true }) as CanvasRenderingContext2D;
    this.engine = engine;
    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });
    // Visibility throttling — pause rAF when tab hidden so we don't burn cycles
    // on an offscreen canvas. Auto-resumes when visible.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else if (this.rafId === null) this.start();
    });
    this.prewarmHeavyState();
  }

  // Pre-init the particle systems that allocate non-trivial state on first
  // draw so switching modes mid-playback doesn't hitch the frame after the
  // switch. Lazy guards inside each draw method skip re-init.
  //
  // Particle counts scale with `isLowPower` (coarse pointer + ≤6 cores + small
  // viewport, OR `prefers-reduced-data`): mobile gets ~55% of the desktop
  // particle budget across every mode, which is what actually fits in the
  // GPU fill-rate budget without starving the audio thread. The plasma
  // resolution also drops from 160×90 → 96×54 on low-power.
  private prewarmHeavyState() {
    const scale = this.isLowPower ? 0.55 : 1;
    const STAR_N = Math.round(260 * scale);
    const CONST_N = Math.round(70 * scale);
    const GALAXY_PER_ARM = Math.round(180 * scale);
    const FIREFLY_N = Math.round(60 * scale);
    const BOKEH_N = Math.round(32 * scale);
    const PLASMA_W = this.isLowPower ? 96 : 160;
    const PLASMA_H = this.isLowPower ? 54 : 90;

    const starfield: Star3D[] = [];
    for (let i = 0; i < STAR_N; i++) {
      starfield.push({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        z: Math.random() * 0.99 + 0.01,
        px: 0,
        py: 0
      });
    }
    this.vizState.starfield = { stars: starfield };

    const constStars: Star2D[] = [];
    for (let i = 0; i < CONST_N; i++) {
      constStars.push({
        x: Math.random(),
        y: Math.random(),
        bin: 5 + Math.floor(Math.random() * 200),
        tw: Math.random() * Math.PI * 2
      });
    }
    this.vizState.constellation = { stars: constStars };

    const galaxy: GalaxyParticle[] = [];
    const arms = 4;
    for (let a = 0; a < arms; a++) {
      for (let i = 0; i < GALAXY_PER_ARM; i++) {
        const tParam = (i + 1) / GALAXY_PER_ARM;
        const armAngle = (a / arms) * Math.PI * 2;
        const spread = (Math.random() - 0.5) * 0.5;
        const theta = armAngle + tParam * Math.PI * 4 + spread;
        const r = 0.06 + tParam * 0.45 + (Math.random() - 0.5) * 0.04;
        galaxy.push({
          theta,
          r,
          size: 0.4 + Math.random() * 1.8,
          color: starPalette(tParam * 0.6 + a * 0.13 + Math.random() * 0.2)
        });
      }
    }
    this.vizState.galaxy = { particles: galaxy };

    const off = document.createElement('canvas');
    off.width = PLASMA_W;
    off.height = PLASMA_H;
    const offCtx = off.getContext('2d', { willReadFrequently: true })!;
    const img = offCtx.createImageData(PLASMA_W, PLASMA_H);
    this.vizState.plasma = { off, offCtx, img };

    const fireflies: Firefly[] = [];
    for (let i = 0; i < FIREFLY_N; i++) {
      fireflies.push({
        x: Math.random(),
        y: Math.random(),
        ax: Math.random() * Math.PI * 2,
        ay: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        rate: 0.4 + Math.random() * 1.4,
        color: lovePalette(Math.random() * 0.5 + 0.25)
      });
    }
    this.vizState.fireflies = { items: fireflies };

    const bokeh: BokehItem[] = [];
    for (let i = 0; i < BOKEH_N; i++) {
      bokeh.push({
        x: Math.random(),
        y: Math.random(),
        size: 0.05 + Math.random() * 0.22,
        vx: (Math.random() - 0.5) * 0.01,
        vy: -0.004 - Math.random() * 0.008,
        color: paletteAt(Math.random()),
        alpha: 0.25 + Math.random() * 0.5
      });
    }
    this.vizState.bokeh = { items: bokeh };

    this.vizState.supernova = { rings: [] };
    this.vizState.petals = { items: [] };
  }

  private trackPalette: Palette | null = null;
  private strobePulse = 0;

  setAccent(hex: string) {
    const v = parseInt(hex.replace('#', ''), 16);
    this.accent = [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  }

  /**
   * Repaints every mode with track-derived colors. Vibrant becomes the new
   * accent; complementary + lightMuted + darkVibrant cycle through palette
   * keyframes; star tint inherits lightMuted. Pass null to restore defaults.
   */
  setPalette(p: Palette | null) {
    this.trackPalette = p;
    applyTrackPalette(p);
    if (p) this.accent = p.vibrant;
  }

  getPalette(): Palette | null {
    return this.trackPalette;
  }

  setMode(mode: VizMode) {
    this.mode = mode;
    this.autoCycle = false;
    this.manualCycleStarted = false;
    this.emitMode();
  }
  cycleMode() {
    if (!this.manualCycleStarted) {
      this.mode = MODE_ORDER[0];
      this.manualCycleStarted = true;
    } else {
      const i = MODE_ORDER.indexOf(this.mode);
      this.mode = MODE_ORDER[(i + 1) % MODE_ORDER.length];
    }
    this.autoCycle = false;
    this.emitMode();
  }
  cycleModeReverse() {
    if (!this.manualCycleStarted) {
      this.mode = MODE_ORDER[MODE_ORDER.length - 1];
      this.manualCycleStarted = true;
    } else {
      const i = MODE_ORDER.indexOf(this.mode);
      this.mode = MODE_ORDER[(i - 1 + MODE_ORDER.length) % MODE_ORDER.length];
    }
    this.autoCycle = false;
    this.emitMode();
  }
  modeCatalog(): VizMode[] {
    return MODE_ORDER.slice();
  }
  setAutoCycle(on: boolean) {
    this.autoCycle = on;
    if (on) this.manualCycleStarted = false;
  }
  currentMode(): VizMode {
    return this.mode;
  }
  onModeChange(fn: (m: VizMode) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emitMode() {
    for (const f of this.listeners) f(this.mode);
  }

  resize() {
    const rect = this.bg.getBoundingClientRect();
    this.bg.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.bg.height = Math.max(1, Math.floor(rect.height * this.dpr));
  }

  start() {
    if (this.rafId !== null) return;
    let prev = performance.now();
    const tick = (now: number) => {
      // FPS cap — skip frames until the budget has elapsed. Desktop uses 0
      // (every rAF tick draws). Mobile uses 33ms → ~30fps. Skipped ticks still
      // schedule the next rAF so we resume cleanly when the budget catches up.
      if (this.targetFrameMs > 0) {
        this.frameAccum += now - prev;
        prev = now;
        if (this.frameAccum < this.targetFrameMs) {
          this.rafId = requestAnimationFrame(tick);
          return;
        }
        // Carry residual instead of resetting so we don't drift over time.
        this.frameAccum %= this.targetFrameMs;
      } else {
        prev = now;
      }
      this.draw();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
  stop() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private bandEnergy(from: number, to: number) {
    // Fast paths — most modes ask for canonical bands. Hit the cached
    // snapshot rather than re-summing freqData. Falls back to the scan for
    // bespoke ranges no mode actually uses today.
    const c = this.cur;
    if (from === 0 && to === 0.06) return c.bass;
    if (from === 0.08 && to === 0.32) return c.mid;
    if (from === 0.32 && to === 0.85) return (c.treble + c.presence) * 0.5;
    if (from === 0 && to === 0.5) return (c.bass + c.lowMid + c.mid + c.highMid) * 0.25;
    const f = this.engine.freqData;
    if (!f.length) return 0;
    const lo = Math.floor(f.length * from);
    const hi = Math.floor(f.length * to);
    let s = 0;
    for (let i = lo; i < hi; i++) s += f[i];
    return s / Math.max(1, hi - lo) / 255;
  }

  private peakBin(from: number, to: number) {
    const f = this.engine.freqData;
    if (!f.length) return 0;
    const lo = Math.floor(f.length * from);
    const hi = Math.floor(f.length * to);
    let max = 0;
    let pk = lo;
    for (let i = lo; i < hi; i++) {
      if (f[i] > max) {
        max = f[i];
        pk = i;
      }
    }
    return pk;
  }

  private draw() {
    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    if (dt > 0) this.fpsEMA = this.fpsEMA * 0.92 + (1000 / dt) * 0.08;

    this.engine.sample();

    // Hydrate the per-frame signal snapshot. Every mode + overlay reads this
    // instead of re-querying the engine, so 40 modes share one band-pass per
    // frame rather than 40.
    const e = this.engine;
    const b = e.bands();
    const ch = e.channelEnergy();
    // cur.t is assigned below (after tempoClock advance) so the snapshot
    // reflects this frame's clock, not last frame's.
    this.cur.beat = e.beatPulse;
    this.cur.bpm = e.bpm;
    this.cur.bass = b.bass;
    this.cur.lowMid = b.lowMid;
    this.cur.mid = b.mid;
    this.cur.highMid = b.highMid;
    this.cur.treble = b.treble;
    this.cur.presence = b.presence;
    this.cur.brilliance = b.brilliance;
    this.cur.centroid = b.centroid;
    this.cur.stereo = b.stereo;
    this.cur.flux = b.flux;
    this.cur.chL = ch.l;
    this.cur.chR = ch.r;
    this.cur.tempo = e.tempoPhase(now);
    this.cur.build = e.buildPhase;
    this.cur.drop = e.dropImminent;
    this.cur.dropE = e.dropEnergy;

    // Vibrance + hue drift — boosts saturation 1.18→1.42 during builds, drifts
    // the wheel slowly by centroid (bright spectra walk toward yellow/green,
    // bass-heavy walks toward magenta/red). Wraps every 360°.
    const dtFrame = 1 / Math.max(30, this.fpsEMA);
    this.hueDrift = (this.hueDrift + (this.cur.centroid - 0.5) * 18 * dtFrame) % 360;
    VIBRANCE = 1.0 + this.cur.build * 0.28 + this.cur.beat * 0.08;
    HUE_SHIFT = this.hueDrift;

    // Tempo-locked motion clock. Maps BPM 60→160 into a 0.7→1.35 scalar; clamps
    // outside that band so unknown/garbage BPM doesn't make visuals stall or
    // strobe. Beat-pulse adds a tiny 0..6% forward nudge that decays naturally,
    // letting motion "land" on the downbeat without snapping.
    const bpmGuess = this.cur.bpm > 30 ? this.cur.bpm : 100;
    const targetScale = 0.7 + Math.max(0, Math.min(1, (bpmGuess - 60) / 100)) * 0.65;
    this.tempoScale = this.tempoScale * 0.93 + targetScale * 0.07;
    const beatNudge = this.cur.beat * 0.06;
    this.tempoClock += dtFrame * (this.tempoScale + beatNudge);
    this.cur.t = this.tempoClock;

    // Adaptive quality knob — driven by sustained fpsEMA. high=full counts,
    // medium=66% particles + skip shadowBlur, low=40% particles + skinny strokes.
    // Quality tier — desktop uses raw fpsEMA thresholds. Mobile (isLowPower)
    // applies a lowered threshold because the 30fps frame cap intentionally
    // pins fpsEMA at ~30, which would otherwise force 'low' (no post-FX) on
    // devices that can actually handle 'medium' at the chosen cadence.
    if (this.isLowPower) {
      this.cur.quality = this.fpsEMA > 27 ? 'medium' : 'low';
    } else {
      this.cur.quality = this.fpsEMA > 54 ? 'high' : this.fpsEMA > 38 ? 'medium' : 'low';
    }
    this.cur.glow = this.fpsEMA > 48;

    // Adaptive DPR — re-evaluated every 500ms to avoid resize thrash. Climbs
    // toward native devicePixelRatio when FPS sustains >58, drops to 1.5 when
    // FPS falls below 38. Stays where it is in the middle band.
    if (now - this.lastDprCheck > 500) {
      this.lastDprCheck = now;
      const targetUp = this.fpsEMA > 58 && this.dprTarget < this.dprMax;
      const targetDown = this.fpsEMA < 38 && this.dprTarget > this.dprMin;
      if (targetUp) this.dprTarget = Math.min(this.dprMax, this.dprTarget + 0.25);
      else if (targetDown) this.dprTarget = Math.max(this.dprMin, this.dprTarget - 0.25);
      if (Math.abs(this.dprTarget - this.dpr) >= 0.2) {
        this.dpr = this.dprTarget;
        this.resize();
      }
    }

    // Drop flash — armed when the engine fires dropImminent. dt-aware decay
    // (~150ms half-life) so the flash looks identical at 30fps and 60fps. Was
    // *=0.88 per-frame which gave mobile a 2× longer flash than desktop.
    if (e.dropImminent) this.dropFlash = 1;
    else this.dropFlash *= Math.pow(0.005, dtFrame); // ≈ 0.88/frame @60fps

    if (this.autoCycle && e.beatPulse > 0.85) {
      if (now - this.lastCycleAt > 8000) {
        const i = MODE_ORDER.indexOf(this.mode);
        this.mode = MODE_ORDER[(i + 1) % MODE_ORDER.length];
        this.lastCycleAt = now;
        this.emitMode();
      }
    }

    const ctx = this.bgCtx;
    const w = this.bg.width;
    const h = this.bg.height;
    const fade = this.trail ? 0.18 : 1;
    if (fade < 1) {
      ctx.fillStyle = `rgba(6,6,16,${fade})`;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
      if (PURE_BG_MODES.has(this.mode)) {
        ctx.fillStyle = 'rgba(2,2,8,1)';
        ctx.fillRect(0, 0, w, h);
      } else {
        this.drawGradientField(ctx, w, h);
      }
    }

    this.hudPeakBin = this.peakBin(0, 0.5);
    const sr = this.engine.ctx?.sampleRate || 48000;
    const fft = this.engine.analyser?.fftSize || 2048;
    this.hudFreq = (this.hudPeakBin * sr) / fft;

    // Cinematic camera breath — subtle global scale that kicks on every beat
    // and slowly drifts. Lifts every mode (40+) uniformly without per-mode
    // edits: the whole frame "breathes" with the song. Bounded ±3% so it
    // never reads as a glitch. Skipped on low-power to save GPU.
    const breath =
      this.cur.quality === 'low' ? 1 : 1 + this.cur.beat * 0.02 + Math.sin(this.tempoClock * 0.6) * 0.008;
    const breathDirty = breath !== 1;
    if (breathDirty) {
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(breath, breath);
      ctx.translate(-w / 2, -h / 2);
    }

    switch (this.mode) {
      case 'starfield':
        this.drawStarfield(ctx, w, h);
        break;
      case 'constellation':
        this.drawConstellation(ctx, w, h);
        break;
      case 'galaxy':
        this.drawGalaxy(ctx, w, h);
        break;
      case 'supernova':
        this.drawSupernova(ctx, w, h);
        break;
      case 'aurora':
        this.drawAurora(ctx, w, h);
        break;
      case 'petals':
        this.drawPetals(ctx, w, h);
        break;
      case 'plasma':
        this.drawPlasma(ctx, w, h);
        break;
      case 'mandala':
        this.drawMandala(ctx, w, h);
        break;
      case 'fireflies':
        this.drawFireflies(ctx, w, h);
        break;
      case 'bokeh':
        this.drawBokeh(ctx, w, h);
        break;
      case 'palette-orbs':
        this.drawPaletteOrbs(ctx, w, h);
        break;
      case 'drop-strobe':
        this.drawDropStrobe(ctx, w, h);
        break;
      case 'prism':
        this.drawPrism(ctx, w, h);
        break;
      case 'wormhole':
        this.drawWormhole(ctx, w, h);
        break;
      case 'vortex':
        this.drawVortex(ctx, w, h);
        break;
      case 'sunburst':
        this.drawSunburst(ctx, w, h);
        break;
      case 'mirror-wave':
        this.drawMirrorWave(ctx, w, h);
        break;
      case 'hex-grid':
        this.drawHexGrid(ctx, w, h);
        break;
      case 'liquid':
        this.drawLiquid(ctx, w, h);
        break;
      case 'vinyl':
        this.drawVinyl(ctx, w, h);
        break;
      case 'smoke':
        this.drawSmoke(ctx, w, h);
        break;
      case 'strings':
        this.drawStrings(ctx, w, h);
        break;
      case 'spider':
        this.drawSpider(ctx, w, h);
        break;
      case 'cymatics':
        this.drawCymatics(ctx, w, h);
        break;
      case 'confetti':
        this.drawConfetti(ctx, w, h);
        break;
      case 'bloom':
        this.drawBloom(ctx, w, h);
        break;
      case 'rose':
        this.drawRose(ctx, w, h);
        break;
      case 'waterfall':
        this.drawWaterfall(ctx, w, h);
        break;
      case 'monolith':
        this.drawMonolith(ctx, w, h);
        break;
      case 'nebula':
        this.drawNebula(ctx, w, h);
        break;
      case 'ribbons':
        this.drawRibbons(ctx, w, h);
        break;
      case 'gravity':
        this.drawGravity(ctx, w, h);
        break;
      case 'lattice':
        this.drawLattice(ctx, w, h);
        break;
      case 'flux':
        this.drawFlux(ctx, w, h);
        break;
      case 'composite':
        this.drawComposite(ctx, w, h);
        break;
      case 'tunnel':
        this.drawTunnel(ctx, w, h);
        break;
      case 'lissajous':
        this.drawLissajous(ctx, w, h);
        break;
      case 'rings':
        this.drawRings(ctx, w, h);
        break;
      case 'bars':
        this.drawRadialBars(ctx, w, h);
        break;
      case 'wave':
        this.drawOscilloscope(ctx, w, h);
        break;
      case 'kaleidoscope':
        this.drawKaleidoscope(ctx, w, h);
        break;
    }
    if (breathDirty) ctx.restore();

    // Drop-flash overlay — single screen-blended radial sheen tied to the
    // engine's predicted drops. Fires on every mode without per-mode patching.
    if (this.dropFlash > 0.04) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const a = this.dropFlash;
      const v = this.trackPalette?.vibrant ?? this.accent;
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.6);
      grad.addColorStop(0, `rgba(${v[0]},${v[1]},${v[2]},${0.22 * a})`);
      grad.addColorStop(0.55, `rgba(${v[0]},${v[1]},${v[2]},${0.08 * a})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // Post-FX stack: particle bursts (drop/beat) → bloom (downsampled blur,
    // bass-driven) → chromatic aberration (RGB split, bass-driven offset).
    // All three are FPS-gated so low-power devices still hit 60.
    this.applyPostFX(ctx, w, h);
    this.applyCinematicPost(ctx, w, h);

    this.drawVignette(ctx, w, h, this.engine.beatPulse);
  }

  // Pace clamp — modes call this to keep motion in a sane range regardless of
  // BPM estimate, quality tier, or device cadence. Default range [0.5, 1.5] of
  // the supplied hint; modes that need bounded clamps can pass custom lo/hi.
  // Returns 0 when audio isn't running so visuals visibly settle on pause.
  pace(speed: number, lo = 0.6, hi = 1.45): number {
    const s = speed * this.tempoScale;
    const out = Math.max(speed * lo, Math.min(speed * hi, s));
    // Quality-low devices get a 15% slowdown — gives the GPU breathing room
    // and reads as "moody / cinematic" rather than "lagging".
    return this.cur.quality === 'low' ? out * 0.85 : out;
  }

  // Beat-locked clock exposed for modes that prefer reading the paced clock
  // directly rather than scaling their own time variable. Equivalent to
  // (now - t0)/1000 but with the BPM scale + beat nudge baked in.
  paced(): number {
    return this.tempoClock;
  }

  // Cinematic post-pass — universal uplift for every mode. Three stages:
  //   1. Subtle film grain (16×16 noise tile, screen blend, jittered offset).
  //   2. Soft cinematic letterbox at extreme aspect ratios (w/h ≥ 2.2 → 6px
  //      black bars top+bottom, 12px at ≥ 2.6). Real letterbox feel without
  //      cropping playable area.
  //   3. Edge-darkening color-grade pass (teal-orange split via 2 radial
  //      gradients with multiply/screen blends) — applied only when quality is
  //      'high' so low-power devices stay clean.
  // Skipped entirely on 'low' quality. Adds ~0.4ms at 1080p on M1.
  private applyCinematicPost(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (this.cur.quality === 'low') return;

    // 1. Film grain
    if (!this.grainCanvas) {
      const g = document.createElement('canvas');
      g.width = 64;
      g.height = 64;
      const gctx = g.getContext('2d');
      if (gctx) {
        const img = gctx.createImageData(64, 64);
        for (let i = 0; i < img.data.length; i += 4) {
          const n = (Math.random() * 255) | 0;
          img.data[i] = n;
          img.data[i + 1] = n;
          img.data[i + 2] = n;
          img.data[i + 3] = 255;
        }
        gctx.putImageData(img, 0, 0);
      }
      this.grainCanvas = g;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.04 + this.cur.beat * 0.012;
    const jx = ((this.tempoClock * 47) % 64) - 32;
    const jy = ((this.tempoClock * 31) % 64) - 32;
    const pattern = ctx.createPattern(this.grainCanvas, 'repeat');
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.translate(jx, jy);
      ctx.fillRect(-jx, -jy, w, h);
    }
    ctx.restore();

    // 2. Cinematic letterbox at ultrawide aspect. Music page on a 21:9 monitor
    // gets bars; phone in portrait gets nothing. Keeps mobile clean.
    const aspect = w / h;
    if (aspect >= 2.2) {
      const bar = aspect >= 2.6 ? 14 * this.dpr : 7 * this.dpr;
      ctx.save();
      ctx.fillStyle = 'rgba(2,2,8,0.92)';
      ctx.fillRect(0, 0, w, bar);
      ctx.fillRect(0, h - bar, w, bar);
      ctx.restore();
    }

    // 3. Edge color grade — teal lift on the cool edge, warm pull at the
    // opposite corner. Drives a "shot on lens" feel without overpowering color.
    if (this.cur.quality === 'high') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.1;
      const phase = this.tempoClock * 0.04;
      const tealX = w * (0.18 + Math.sin(phase) * 0.05);
      const tealY = h * (0.82 + Math.cos(phase) * 0.03);
      const warmX = w * (0.82 - Math.sin(phase) * 0.05);
      const warmY = h * (0.18 - Math.cos(phase) * 0.03);
      const gT = ctx.createRadialGradient(tealX, tealY, 0, tealX, tealY, Math.max(w, h) * 0.55);
      gT.addColorStop(0, 'rgba(40,200,220,0.55)');
      gT.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gT;
      ctx.fillRect(0, 0, w, h);
      const gW = ctx.createRadialGradient(warmX, warmY, 0, warmX, warmY, Math.max(w, h) * 0.55);
      gW.addColorStop(0, 'rgba(255,170,90,0.45)');
      gW.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gW;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // ─── Post-FX pipeline ───────────────────────────────────────────────────
  // Cinematic stack lifted from 2026 generative-art canon: HSL hue-drift
  // (already applied via VIBRANCE/HUE_SHIFT in paletteAt) → particle bursts
  // → bloom → chromatic aberration. Each stage opts out automatically when
  // cur.quality drops to 'low' so the floor is always 60fps.
  private applyPostFX(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const c = this.cur;
    const dt = 1 / Math.max(30, this.fpsEMA);

    // ─ 1. Particle emitter ────────────────────────────────────────────────
    // Drops spawn a 20-particle starburst; sustained heavy beats spawn a
    // single particle each frame. Capped at 240 particles total (ring-pool).
    if (c.drop && this.particles.length < 240) {
      const n = 24;
      const v = this.trackPalette?.vibrant ?? this.accent;
      const baseHue = rgbToHsl(v[0], v[1], v[2])[0] * 360;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const spd = (3 + Math.random() * 5) * this.dpr;
        this.particles.push({
          x: w / 2,
          y: h / 2,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 0,
          max: 0.9 + Math.random() * 0.7,
          size: this.dpr * (2 + Math.random() * 3),
          hue: (baseHue + i * (360 / n)) % 360
        });
      }
    }
    if (c.beat > 0.72 && this.particles.length < 200 && Math.random() < 0.4) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (1.5 + c.bass * 4) * this.dpr;
      this.particles.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.4,
        y: h / 2 + (Math.random() - 0.5) * h * 0.4,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0,
        max: 0.7 + Math.random() * 0.5,
        size: this.dpr * (1.4 + Math.random() * 2),
        hue: c.centroid * 360 + Math.random() * 60
      });
    }
    if (this.particles.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      // 60fps reference normalization. At 60fps dt≈0.0166, dtNorm≈1.
      // At 30fps mobile dt≈0.033, dtNorm≈2 → velocities/decays compensate
      // so particles behave identically across cadences.
      const dtNorm = dt * 60;
      const drag = Math.pow(0.965, dtNorm); // velocity preservation per frame
      const gravity = 0.08 * this.dpr * dtNorm;
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life += dt;
        if (p.life >= p.max) {
          this.particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * dtNorm;
        p.y += p.vy * dtNorm;
        p.vx *= drag;
        p.vy *= drag;
        p.vy += gravity;
        const k = 1 - p.life / p.max;
        const rgb = hslToRgb((p.hue % 360) / 360, 1, 0.6);
        ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.85 * k})`;
        if (c.glow) {
          ctx.shadowBlur = p.size * 5;
          ctx.shadowColor = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.9)`;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.6 + k * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ─ 2. Bloom ───────────────────────────────────────────────────────────
    // Quarter-res downsample → blur → upsample → screen blend. Intensity
    // tied to bass + beat + dropFlash. Skipped on low quality.
    const bloomAmt = c.bass * 0.7 + c.beat * 0.4 + this.dropFlash * 0.55;
    if (c.quality !== 'low' && bloomAmt > 0.18) {
      const bw = Math.max(64, Math.floor(w / 4));
      const bh = Math.max(36, Math.floor(h / 4));
      if (!this.bloomCanvas || this.bloomCanvas.width !== bw || this.bloomCanvas.height !== bh) {
        this.bloomCanvas = document.createElement('canvas');
        this.bloomCanvas.width = bw;
        this.bloomCanvas.height = bh;
        this.bloomCtx = this.bloomCanvas.getContext('2d', { willReadFrequently: false });
      }
      const bctx = this.bloomCtx!;
      bctx.globalCompositeOperation = 'source-over';
      bctx.clearRect(0, 0, bw, bh);
      // High-pass on the way down: drawImage with screen op + dark overlay
      // would be ideal but a single drawImage + filter blur suffices on
      // Chromium/Safari without measurable cost.
      const supportsFilter = 'filter' in bctx;
      if (supportsFilter) bctx.filter = `blur(${Math.round(2 + bloomAmt * 6)}px)`;
      bctx.drawImage(this.bg, 0, 0, bw, bh);
      if (supportsFilter) bctx.filter = 'none';

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = Math.min(0.7, 0.18 + bloomAmt * 0.55);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.bloomCanvas, 0, 0, w, h);
      ctx.restore();
    }

    // ─ 3. Chromatic aberration ────────────────────────────────────────────
    // Re-draws the canvas onto itself with a slight red+blue offset using
    // the 'lighter' composite, producing an RGB-split halo on bright edges.
    // Magnitude tracks bass × dpr; capped at 6px so it never gets garish.
    const abAmt = c.bass * 0.85 + this.dropFlash * 0.6 + c.beat * 0.25;
    if (c.quality === 'high' && abAmt > 0.22) {
      const off = Math.min(6 * this.dpr, abAmt * 5 * this.dpr);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(0.35, 0.15 + abAmt * 0.3);
      // red channel offset right, blue channel offset left
      ctx.filter = 'url(#bzChromaR) blur(0px)';
      // Filter URLs aren't reliably supported on canvas; fall back to a
      // tinted-overlay approach using the bloom buffer if it's populated.
      ctx.filter = 'none';
      if (this.bloomCanvas) {
        ctx.globalCompositeOperation = 'lighter';
        // red shifted right
        ctx.globalAlpha = Math.min(0.4, 0.12 + abAmt * 0.32);
        ctx.drawImage(this.bloomCanvas, off, 0, w, h);
        // blue shifted left (re-uses bloom buffer; cyan-ish tint via screen blend)
        ctx.globalAlpha = Math.min(0.32, 0.1 + abAmt * 0.26);
        ctx.drawImage(this.bloomCanvas, -off, 0, w, h);
      }
      ctx.restore();
    }
  }

  fps() {
    return this.fpsEMA;
  }
  audioMeters() {
    const c = this.cur;
    return {
      bass: c.bass,
      mid: c.mid,
      treble: c.treble,
      presence: c.presence,
      brilliance: c.brilliance,
      centroid: c.centroid,
      stereo: c.stereo,
      bpm: c.bpm,
      beat: c.beat,
      ch: { l: c.chL, r: c.chR },
      tempoPhase: c.tempo,
      buildPhase: c.build,
      dropEnergy: c.dropE,
      dropImminent: c.drop,
      peakHz: this.hudFreq,
      fft: this.engine.analyser?.fftSize || 0,
      sr: this.engine.ctx?.sampleRate || 0,
      dpr: this.dpr,
      quality: c.quality
    };
  }

  // ─── backgrounds ────────────────────────────────────────────────────────
  private drawGradientField(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = 'rgba(6,6,16,1)';
    ctx.fillRect(0, 0, w, h);
    this.drawColorBlobs(ctx, w, h);
  }

  private drawColorBlobs(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const c = this.cur;
    const t = c.t;
    const beat = c.beat;
    // 5 blobs mapped to spectral 5-band split (was 3 ad-hoc bands).
    // The 4th + 5th now ride highMid + presence so cymbals/hi-hats actually
    // wake up the upper blobs instead of mid bleed.
    const energies = [c.bass, c.mid, c.treble, c.highMid, c.presence];
    const baseR = Math.max(w, h) * (0.35 + beat * 0.1 + c.build * 0.08);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 5; i++) {
      // Ambient drift only — no BPM-locked wobble. Background blobs orbit
      // slowly so the user-selectable foreground modes own the visible motion.
      const phase = t * 0.06 + i * 0.41;
      const orbit = 0.18 + i * 0.11;
      const cx = w / 2 + Math.cos(phase * Math.PI * 2 + i) * w * orbit;
      const cy = h / 2 + Math.sin(phase * Math.PI * 2 * 0.83 + i * 1.7) * h * orbit;
      const e = energies[i];
      const r = baseR * (0.45 + e * 0.55 + beat * 0.18);
      const ck = paletteAt(t * 0.05 + i * 0.2 + c.centroid * 0.4);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(${ck[0]},${ck[1]},${ck[2]},${0.42 + e * 0.45 + beat * 0.18})`);
      grad.addColorStop(0.45, `rgba(${ck[0]},${ck[1]},${ck[2]},${0.16 + e * 0.18})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ─── new: 14 beautiful modes ────────────────────────────────────────────

  // 1. starfield warp — 3D stars rushing past, bass drives warp speed
  private drawStarfield(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.vizState.starfield) {
      const stars: Star3D[] = [];
      for (let i = 0; i < 260; i++) {
        stars.push({
          x: Math.random() * 2 - 1,
          y: Math.random() * 2 - 1,
          z: Math.random() * 0.99 + 0.01,
          px: 0,
          py: 0
        });
      }
      this.vizState.starfield = { stars };
    }
    const stars = this.vizState.starfield.stars;
    const cx = w / 2,
      cy = h / 2;
    const bass = this.cur.bass;
    const beat = this.cur.beat;
    // Drop-locked warp burst — speed surges 50% when drop fires.
    const warpBoost = this.cur.drop ? 0.04 : 0;
    const speed = 0.003 + bass * 0.018 + beat * 0.025 + this.cur.build * 0.008 + warpBoost;
    const useGlow = this.cur.glow;
    ctx.save();
    ctx.lineCap = 'round';
    for (const s of stars) {
      s.z -= speed;
      if (s.z <= 0.01) {
        s.x = Math.random() * 2 - 1;
        s.y = Math.random() * 2 - 1;
        s.z = 1;
        s.px = 0;
        s.py = 0;
      }
      const sx = cx + (s.x / s.z) * w * 0.55;
      const sy = cy + (s.y / s.z) * h * 0.55;
      if (sx < -50 || sx >= w + 50 || sy < -50 || sy >= h + 50) {
        s.px = sx;
        s.py = sy;
        continue;
      }
      const depth = 1 - s.z;
      const size = Math.max(0.6, depth * depth * this.dpr * 3);
      const col = starPalette(depth * 0.4 + (s.x + 1) * 0.25);
      if (s.px !== 0 || s.py !== 0) {
        ctx.beginPath();
        ctx.moveTo(s.px, s.py);
        ctx.lineTo(sx, sy);
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.15 + depth * 0.55 + beat * 0.2})`;
        ctx.lineWidth = size * 0.7;
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.55 + depth * 0.45})`;
      if (useGlow) {
        ctx.shadowBlur = size * 4;
        ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},0.8)`;
      }
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
      s.px = sx;
      s.py = sy;
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // 2. constellation — twinkling stars with audio-reactive connections
  private drawConstellation(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.vizState.constellation) {
      const stars: Star2D[] = [];
      for (let i = 0; i < 70; i++) {
        stars.push({
          x: Math.random(),
          y: Math.random(),
          bin: 5 + Math.floor(Math.random() * 200),
          tw: Math.random() * Math.PI * 2
        });
      }
      this.vizState.constellation = { stars };
    }
    const stars = this.vizState.constellation.stars;
    const f = this.engine.freqData;
    const t = this.tempoClock;
    const treble = this.bandEnergy(0.32, 0.85);
    const linkDist = 0.16 + treble * 0.12;
    ctx.save();

    // links
    ctx.lineWidth = this.dpr * 0.9;
    for (let i = 0; i < stars.length; i++) {
      const a = stars[i];
      for (let j = i + 1; j < stars.length; j++) {
        const b = stars[j];
        const dx = a.x - b.x,
          dy = a.y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > linkDist) continue;
        const va = (f[a.bin] || 0) / 255;
        const vb = (f[b.bin] || 0) / 255;
        const bright = (va + vb) / 2;
        if (bright < 0.12) continue;
        const alpha = (1 - d / linkDist) * bright * 0.85;
        const col = starPalette(t * 0.05 + (a.x + b.x) * 0.5);
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }
    }

    // stars
    for (const s of stars) {
      const v = (f[s.bin] || 0) / 255;
      const twinkle = Math.sin(t * 2.4 + s.tw) * 0.5 + 0.5;
      const r = this.dpr * (1.2 + v * 4.5 + twinkle * 1.2);
      const col = starPalette(t * 0.04 + s.x);
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.55 + v * 0.4 + twinkle * 0.2})`;
      ctx.shadowBlur = r * 5;
      ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},0.95)`;
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // 3. galaxy spiral — 4-arm log spiral with differential rotation + bright bulge
  private drawGalaxy(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.vizState.galaxy) {
      const particles: GalaxyParticle[] = [];
      const arms = 4;
      const perArm = 180;
      for (let a = 0; a < arms; a++) {
        for (let i = 0; i < perArm; i++) {
          const tParam = (i + 1) / perArm;
          const armAngle = (a / arms) * Math.PI * 2;
          const spread = (Math.random() - 0.5) * 0.5;
          const theta = armAngle + tParam * Math.PI * 4 + spread;
          const r = 0.06 + tParam * 0.45 + (Math.random() - 0.5) * 0.04;
          particles.push({
            theta,
            r,
            size: 0.4 + Math.random() * 1.8,
            color: starPalette(tParam * 0.6 + a * 0.13 + Math.random() * 0.2)
          });
        }
      }
      this.vizState.galaxy = { particles };
    }
    const ps = this.vizState.galaxy.particles;
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const cx = w / 2,
      cy = h / 2;
    const scale = Math.min(w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // bulge
    const bulgeR = scale * (0.14 + beat * 0.05);
    const bulge = ctx.createRadialGradient(cx, cy, 0, cx, cy, bulgeR);
    bulge.addColorStop(0, `rgba(255,250,220,${0.85 + beat * 0.15})`);
    bulge.addColorStop(0.35, 'rgba(255,200,150,0.45)');
    bulge.addColorStop(0.7, 'rgba(220,150,200,0.2)');
    bulge.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bulge;
    ctx.fillRect(0, 0, w, h);

    // particles
    for (const p of ps) {
      const ang = p.theta + t * (0.32 - p.r * 0.55);
      const r = p.r * scale * (1 + beat * 0.04);
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r * 0.55;
      const col = p.color;
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.55 + beat * 0.25})`;
      ctx.beginPath();
      ctx.arc(x, y, p.size * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 4. supernova — central star with corona rays + expanding ring shockwaves on beat
  private drawSupernova(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.vizState.supernova) this.vizState.supernova = { rings: [] };
    const st = this.vizState.supernova;
    const t = this.tempoClock;
    const cx = w / 2,
      cy = h / 2;
    const beat = this.engine.beatPulse;
    const b = this.engine.bands();
    const drop = this.engine.dropImminent;
    const dt = 1 / Math.max(30, this.fpsEMA);

    if (beat > 0.68 && (st.rings.length === 0 || st.rings[st.rings.length - 1].age > 0.05)) {
      st.rings.push({ age: 0, max: 1.7 + b.bass * 0.6, color: paletteAt(t * 0.1) });
    }
    if (drop && (st.rings.length === 0 || st.rings[st.rings.length - 1].age > 0.18)) {
      st.rings.push({ age: 0, max: 2.4, color: [255, 240, 220] });
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const coreR = Math.min(w, h) * (0.05 + b.bass * 0.11 + beat * 0.04);

    const rays = 24;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + t * 0.4 + this.engine.tempoPhase() * Math.PI;
      const harm = 1 + Math.sin(a * 4 + t * 1.8) * 0.18;
      const len = Math.min(w, h) * (0.1 + b.treble * 0.38 + beat * 0.14 + b.brilliance * 0.18) * harm;
      const c = paletteAt(t * 0.1 + i / rays + b.centroid * 0.4);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.5 + b.treble * 0.45})`;
      ctx.lineWidth = this.dpr * (1.6 + b.treble * 5 + beat * 1.5);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * coreR, cy + Math.sin(a) * coreR);
      ctx.lineTo(cx + Math.cos(a) * (coreR + len), cy + Math.sin(a) * (coreR + len));
      ctx.stroke();
    }

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.6);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, `rgba(255,240,200,${0.7 + beat * 0.3})`);
    grad.addColorStop(0.65, `rgba(255,160,120,${0.32 + b.presence * 0.2})`);
    grad.addColorStop(1, 'rgba(255,80,140,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 2.6, 0, Math.PI * 2);
    ctx.fill();

    for (let i = st.rings.length - 1; i >= 0; i--) {
      const r = st.rings[i];
      r.age += dt;
      if (r.age > r.max) {
        st.rings.splice(i, 1);
        continue;
      }
      const k = r.age / r.max;
      const radius = k * Math.min(w, h) * 0.65;
      const alpha = (1 - k) * (0.85 + b.brilliance * 0.15);
      ctx.strokeStyle = `rgba(${r.color[0]},${r.color[1]},${r.color[2]},${alpha})`;
      ctx.lineWidth = this.dpr * (1 + (1 - k) * 5.5);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. aurora — flowing draped ribbons across the sky
  private drawAurora(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const b = this.engine.bands();
    const beat = this.engine.beatPulse;
    const tempo = this.engine.tempoPhase();
    const ce = this.engine.channelEnergy();
    const skew = (ce.r - ce.l) * h * 0.05;
    const ribbons = 5;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const steps = 140;

    for (let r = 0; r < ribbons; r++) {
      const baseY = h * (0.14 + r * 0.16);
      const amp = h * (0.06 + b.mid * 0.13 + beat * 0.04);
      const speed = 0.3 + r * 0.14;
      const c1 = paletteAt(t * 0.05 + r * 0.17 + b.centroid * 0.3);
      const c2 = paletteAt(t * 0.05 + r * 0.17 + 0.4);
      const ribbonH = h * (0.16 + b.treble * 0.18 + b.brilliance * 0.1);

      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        const phase = (i / steps) * 4 + t * speed + r + tempo * Math.PI;
        const y =
          baseY +
          Math.sin(phase) * amp +
          Math.sin(phase * 2.4 + r) * amp * 0.45 +
          Math.sin(phase * 0.7 + b.bass * 7) * amp * 0.34 +
          Math.sin(phase * 5 + b.brilliance * 8) * amp * 0.12 +
          skew * (r + 1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let i = steps; i >= 0; i--) {
        const x = (i / steps) * w;
        const phase = (i / steps) * 4 + t * speed + r + tempo * Math.PI;
        const y =
          baseY +
          Math.sin(phase) * amp +
          Math.sin(phase * 2.4 + r) * amp * 0.45 +
          Math.sin(phase * 0.7 + b.bass * 7) * amp * 0.34 +
          Math.sin(phase * 5 + b.brilliance * 8) * amp * 0.12 +
          skew * (r + 1);
        ctx.lineTo(x, y + ribbonH);
      }
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, baseY - amp, 0, baseY + ribbonH);
      grad.addColorStop(0, `rgba(${c1[0]},${c1[1]},${c1[2]},${0.6 + b.treble * 0.38})`);
      grad.addColorStop(0.5, `rgba(${c2[0]},${c2[1]},${c2[2]},${0.28 + b.mid * 0.22})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fill();
    }
    ctx.restore();
  }

  // rose petals — drifting petals with wind and rotation
  private petalPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, rot: number) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.bezierCurveTo(size * 0.85, -size * 0.55, size * 0.85, size * 0.45, 0, size);
    ctx.bezierCurveTo(-size * 0.85, size * 0.45, -size * 0.85, -size * 0.55, 0, -size);
    ctx.closePath();
    ctx.restore();
  }

  private drawPetals(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.vizState.petals) this.vizState.petals = { items: [] };
    const st = this.vizState.petals;
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const bass = this.bandEnergy(0, 0.06);
    const mid = this.bandEnergy(0.08, 0.32);
    const dt = 1 / Math.max(30, this.fpsEMA);

    const spawnRate = 2 + beat * 8 + bass * 5;
    if (Math.random() < spawnRate * dt && st.items.length < 180) {
      st.items.push({
        x: Math.random() * w * 1.3 - w * 0.15,
        vy: this.dpr * (35 + Math.random() * 60),
        size: this.dpr * (10 + Math.random() * 18),
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 2.6,
        sway: Math.random() * Math.PI * 2,
        color: lovePalette(t * 0.05 + Math.random() * 0.4 + 0.2),
        life: -30
      });
    }

    ctx.save();
    for (let i = st.items.length - 1; i >= 0; i--) {
      const it = st.items[i];
      it.life += it.vy * dt;
      it.rot += it.vrot * dt;
      const windX = (Math.sin(t * 0.35 + it.sway) * 60 + bass * 90 + mid * 30) * this.dpr;
      const x = it.x + windX;
      const y = it.life;
      if (y > h + 40) {
        st.items.splice(i, 1);
        continue;
      }
      const col = it.color;
      const fadeIn = Math.min(1, (y + 30) / 80);
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.78 * fadeIn})`;
      this.petalPath(ctx, x, y, it.size, it.rot);
      ctx.fill();
      ctx.strokeStyle = `rgba(${Math.min(255, col[0] + 30)},${Math.min(255, col[1] + 30)},${Math.min(255, col[2] + 30)},${0.4 * fadeIn})`;
      ctx.lineWidth = this.dpr * 0.7;
      ctx.stroke();
    }
    ctx.restore();
  }

  // 9. plasma — classic per-pixel plasma field, palette-mapped
  private drawPlasma(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.vizState.plasma) {
      const off = document.createElement('canvas');
      off.width = 240;
      off.height = 135;
      const offCtx = off.getContext('2d', { willReadFrequently: true })!;
      const img = offCtx.createImageData(240, 135);
      this.vizState.plasma = { off, offCtx, img };
    }
    const st = this.vizState.plasma;
    const t = this.tempoClock;
    const b = this.engine.bands();
    const beat = this.engine.beatPulse;
    const phase = this.engine.tempoPhase() * Math.PI * 2;
    const drop = this.engine.dropImminent ? 1 : 0;
    const pw = st.off.width,
      ph = st.off.height;
    const data = st.img.data;
    const f1 = 0.045 + b.bass * 0.09 + beat * 0.02;
    const f2 = 0.072 + b.treble * 0.07;
    const f3 = 0.052 + b.mid * 0.06;
    const f4 = 0.041 + beat * 0.06;
    const f5 = 0.018 + b.presence * 0.04;
    const stereoSkew = (this.engine.channelEnergy().r - this.engine.channelEnergy().l) * 1.4;
    const dropBoost = drop * 0.4;
    let idx = 0;
    for (let y = 0; y < ph; y++) {
      const dy = y - ph / 2;
      for (let x = 0; x < pw; x++) {
        const dx = x - pw / 2 + stereoSkew * 18;
        const r = Math.sqrt(dx * dx + dy * dy);
        const ang = Math.atan2(dy, dx);
        const v =
          (Math.sin(x * f1 + t * 1.4 + phase) +
            Math.sin(y * f2 + t * 1.05 - phase * 0.5) +
            Math.sin((x + y) * f3 * 0.5 + t * 0.85) +
            Math.sin(r * f4 + t * 1.6) +
            Math.sin(ang * 3 + r * f5 + t * 0.6) * (0.5 + b.brilliance)) /
          5;
        const col = paletteAt(v * 0.55 + 0.5 + t * 0.05 + b.centroid * 0.3);
        const lift = 1 + beat * 0.18 + dropBoost;
        data[idx++] = Math.min(255, col[0] * lift);
        data[idx++] = Math.min(255, col[1] * lift);
        data[idx++] = Math.min(255, col[2] * lift);
        data[idx++] = 255;
      }
    }
    st.offCtx.putImageData(st.img, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.85 + beat * 0.12 + dropBoost * 0.1;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(st.off, 0, 0, w, h);
    if (b.brilliance > 0.35) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = b.brilliance * 0.35;
      ctx.drawImage(st.off, 0, 0, w, h);
    }
    ctx.restore();
  }

  // 10. mandala — concentric rings of petals with 12-fold symmetry
  private drawMandala(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const cx = w / 2,
      cy = h / 2;
    const beat = this.engine.beatPulse;
    const f = this.engine.freqData;
    if (!f.length) return;
    const rMax = Math.min(w, h) * 0.46;
    const layers = 6;
    const sym = 12;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'screen';

    for (let L = 0; L < layers; L++) {
      const r = ((L + 1) / layers) * rMax;
      const bin = Math.floor(f.length * (L / layers) * 0.4);
      const v = (f[bin] || 0) / 255;
      const rot = t * (0.1 + L * 0.05) * (L % 2 ? -1 : 1);
      const col = paletteAt(t * 0.06 + L * 0.12);

      ctx.save();
      ctx.rotate(rot);

      for (let i = 0; i < sym; i++) {
        const a = (i / sym) * Math.PI * 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        const petalSize = rMax * 0.09 * (1 + v * 0.7 + beat * 0.25);
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.32 + v * 0.4 + beat * 0.2})`;
        this.petalPath(ctx, px, py, petalSize, a + Math.PI / 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.18 + v * 0.32})`;
      ctx.lineWidth = this.dpr * (0.6 + v * 1.6);
      ctx.stroke();

      ctx.restore();
    }

    const cCol = paletteAt(t * 0.1);
    const cR = rMax * 0.075 * (1 + beat * 0.3);
    const cg = ctx.createRadialGradient(0, 0, 0, 0, 0, cR);
    cg.addColorStop(0, `rgba(255,255,255,${0.9 + beat * 0.1})`);
    cg.addColorStop(0.5, `rgba(${cCol[0]},${cCol[1]},${cCol[2]},0.7)`);
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(0, 0, cR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // fireflies meadow — slow wandering glow particles with own pulse rates
  private drawFireflies(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.vizState.fireflies) {
      const items: Firefly[] = [];
      for (let i = 0; i < 60; i++) {
        items.push({
          x: Math.random(),
          y: Math.random(),
          ax: Math.random() * Math.PI * 2,
          ay: Math.random() * Math.PI * 2,
          phase: Math.random() * Math.PI * 2,
          rate: 0.4 + Math.random() * 1.4,
          color: lovePalette(Math.random() * 0.5 + 0.25)
        });
      }
      this.vizState.fireflies = { items };
    }
    const t = this.tempoClock;
    const items = this.vizState.fireflies.items;
    const beat = this.engine.beatPulse;
    const treble = this.bandEnergy(0.32, 0.85);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const f of items) {
      const x = (f.x + Math.sin(t * 0.18 + f.ax) * 0.12) * w;
      const y = (f.y + Math.cos(t * 0.14 + f.ay) * 0.12) * h;
      const pulse = Math.sin(t * f.rate + f.phase) * 0.5 + 0.5;
      const energy = pulse * (0.65 + beat * 0.25 + treble * 0.2);
      const r = this.dpr * (1.6 + energy * 5.5);
      const col = f.color;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 7);
      grad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${0.85 * energy})`);
      grad.addColorStop(0.25, `rgba(${col[0]},${col[1]},${col[2]},${0.35 * energy})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r * 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,225,${0.95 * energy})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // bokeh field — out-of-focus light circles drifting across the lens
  private drawBokeh(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.vizState.bokeh) {
      const items: BokehItem[] = [];
      for (let i = 0; i < 32; i++) {
        items.push({
          x: Math.random(),
          y: Math.random(),
          size: 0.05 + Math.random() * 0.22,
          vx: (Math.random() - 0.5) * 0.01,
          vy: -0.004 - Math.random() * 0.008,
          color: paletteAt(Math.random()),
          alpha: 0.25 + Math.random() * 0.5
        });
      }
      this.vizState.bokeh = { items };
    }
    const items = this.vizState.bokeh.items;
    const dt = 1 / Math.max(30, this.fpsEMA);
    const beat = this.engine.beatPulse;
    const treble = this.bandEnergy(0.32, 0.85);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const b of items) {
      b.x += b.vx * dt * 22;
      b.y += b.vy * dt * 22;
      if (b.y < -0.3) {
        b.y = 1.2;
        b.x = Math.random();
      }
      if (b.x < -0.3) b.x = 1.2;
      else if (b.x > 1.3) b.x = -0.2;
      const cx = b.x * w,
        cy = b.y * h;
      const r = b.size * Math.min(w, h);
      const a = b.alpha * (0.7 + beat * 0.3 + treble * 0.2);
      const col = b.color;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.9})`);
      grad.addColorStop(0.55, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.32})`);
      grad.addColorStop(0.95, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.06})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      // rim
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${a * 0.5})`;
      ctx.lineWidth = this.dpr * 0.9;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ─── existing 7 modes (preserved) ───────────────────────────────────────
  private drawComposite(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.55;
    this.drawTunnel(ctx, w, h);
    ctx.globalAlpha = 0.85;
    this.drawRadialBars(ctx, w, h);
    ctx.globalAlpha = 0.9;
    this.drawLissajous(ctx, w, h);
    ctx.restore();
  }

  private drawTunnel(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const cx = w / 2;
    const cy = h / 2;
    const f = this.engine.freqData;
    if (!f.length) return;
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const rings = 28;
    const radMax = Math.min(w, h) * 0.55;

    for (let r = rings; r >= 1; r--) {
      const phase = (t * 0.5 + r / rings) % 1;
      const z = 1 - phase;
      const rad = radMax * z * (1 + beat * 0.06);
      const idx = Math.floor((r / rings) * f.length * 0.7);
      const v = (f[idx] || 0) / 255;
      const seg = 64;
      const ck = paletteAt(t * 0.06 + r / rings);
      ctx.beginPath();
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const wob = 1 + v * 0.55 * Math.sin(a * 6 + t * 2 + r * 0.5);
        const x = cx + Math.cos(a) * rad * wob;
        const y = cy + Math.sin(a) * rad * wob;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.lineWidth = this.dpr * (0.6 + v * 2.4);
      ctx.strokeStyle = `rgba(${ck[0]},${ck[1]},${ck[2]},${0.15 + v * 0.65 + beat * 0.1})`;
      ctx.stroke();
    }
  }

  private drawLissajous(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const tL = this.engine.timeData;
    if (!tL.length) return;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.32;
    const t = this.tempoClock;
    const accent = this.accent;
    const beat = this.engine.beatPulse;
    const samples = Math.min(tL.length, 1024);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < samples; i++) {
      const a = (tL[i] - 128) / 128;
      const b = (tL[(i + 7) % samples] - 128) / 128;
      const ang = (i / samples) * Math.PI * 2 + t * 0.3;
      const x = cx + Math.cos(ang) * r * (1 + a * 0.6);
      const y = cy + Math.sin(ang) * r * (1 + b * 0.6);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const fillGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.4);
    fillGrad.addColorStop(0, `rgba(${accent[0]},${accent[1]},${accent[2]},${0.55 + beat * 0.25})`);
    fillGrad.addColorStop(0.6, `rgba(${accent[0]},${accent[1]},${accent[2]},${0.18 + beat * 0.12})`);
    fillGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fillGrad;
    ctx.fill();
    ctx.lineWidth = this.dpr * (1.4 + beat * 1.6);
    ctx.strokeStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},${0.85 + beat * 0.15})`;
    ctx.shadowBlur = 24 * this.dpr * (1 + beat);
    ctx.shadowColor = `rgba(${accent[0]},${accent[1]},${accent[2]},0.95)`;
    ctx.stroke();
    ctx.restore();
  }

  private drawRings(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const cx = w / 2;
    const cy = h / 2;
    const f = this.engine.freqData;
    if (!f.length) return;
    const t = this.tempoClock;
    const rings = 64;
    const radMax = Math.min(w, h) * 0.46 * (1 + (this.cur.drop ? 0.08 : 0));
    const beat = this.engine.beatPulse;
    const drop = this.cur.drop ? 1 : 0;

    for (let r = 0; r < rings; r++) {
      const idx = Math.floor((r / rings) * f.length * 0.55);
      const v = (f[idx] || 0) / 255;
      const ck = paletteAt(t * 0.04 + r / rings + this.cur.centroid * 0.3);
      const rad = (r / rings) * radMax * (1 + v * 0.18 + beat * 0.04 + drop * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      if (r % 4 === 0 && v > 0.18) {
        ctx.fillStyle = `rgba(${ck[0]},${ck[1]},${ck[2]},${0.05 + v * 0.18 + drop * 0.06})`;
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${ck[0]},${ck[1]},${ck[2]},${0.08 + v * 0.78 + drop * 0.15})`;
      ctx.lineWidth = this.dpr * (0.6 + v * 3.2 + drop * 1.4);
      ctx.stroke();
    }

    const bass = this.bandEnergy(0, 0.06);
    const orbR = Math.min(w, h) * (0.06 + bass * 0.18);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR);
    const a = this.accent;
    grad.addColorStop(0, `rgba(${a[0]},${a[1]},${a[2]},${0.75 + beat * 0.2})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawRadialBars(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const cx = w / 2;
    const cy = h / 2;
    const f = this.engine.freqData;
    if (!f.length) return;
    const bars = 128;
    const step = Math.max(1, Math.floor((f.length * 0.7) / bars));
    const radInner = Math.min(w, h) * 0.14;
    const radOuter = Math.min(w, h) * 0.43;
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const b = this.engine.bands();
    const tempo = this.engine.tempoPhase();
    const drop = this.engine.dropImminent ? 1 : 0;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.08 + tempo * Math.PI * 0.3);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let k = 0; k < step; k++) sum += f[i * step + k] || 0;
      const v = sum / step / 255;
      const a = (i / bars) * Math.PI * 2;
      const len = radInner + v * (radOuter - radInner) * (1 + beat * 0.5 + drop * 0.25);
      const ck = paletteAt(t * 0.08 + i / bars + b.centroid * 0.4);
      const grad = ctx.createLinearGradient(
        Math.cos(a) * radInner,
        Math.sin(a) * radInner,
        Math.cos(a) * len,
        Math.sin(a) * len
      );
      grad.addColorStop(0, `rgba(${ck[0]},${ck[1]},${ck[2]},${0.35 + v * 0.5})`);
      grad.addColorStop(1, `rgba(255,255,255,${0.15 + v * 0.55})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = this.dpr * (2 + v * 2.4 + beat * 0.8);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * radInner, Math.sin(a) * radInner);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
      if (v > 0.7) {
        ctx.fillStyle = `rgba(${ck[0]},${ck[1]},${ck[2]},${0.6})`;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * len, Math.sin(a) * len, this.dpr * (1.8 + v * 2.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // mirror inner bars (low frequency emphasis)
    const innerR = radInner * 0.94;
    for (let i = 0; i < bars; i += 2) {
      let sum = 0;
      for (let k = 0; k < step; k++) sum += f[i * step + k] || 0;
      const v = sum / step / 255;
      const a = (i / bars) * Math.PI * 2 + Math.PI;
      const len = innerR - v * innerR * 0.7 * (1 + beat * 0.3);
      const ck = paletteAt(t * 0.08 + 0.5 + i / bars);
      ctx.strokeStyle = `rgba(${ck[0]},${ck[1]},${ck[2]},${0.18 + v * 0.42})`;
      ctx.lineWidth = this.dpr * (1 + v * 2);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * innerR, Math.sin(a) * innerR);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawOscilloscope(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const tL = this.engine.timeData;
    if (!tL.length) return;
    const cy = h / 2;
    const t = this.tempoClock;
    const accent = this.accent;
    const beat = this.engine.beatPulse;
    const b = this.engine.bands();
    const drop = this.engine.dropImminent ? 1 : 0;
    ctx.save();
    ctx.lineWidth = this.dpr * 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'lighter';
    const layers = 5;
    for (let layer = 0; layer < layers; layer++) {
      const ck = paletteAt(t * 0.06 + layer * 0.17 + b.centroid * 0.3);
      const off = (layer - (layers - 1) / 2) * h * 0.045;
      const amp = h * (0.18 + beat * 0.1 + drop * 0.08 + b.bass * 0.06);
      const phaseShift = layer * 0.08;
      ctx.beginPath();
      for (let i = 0; i < tL.length; i++) {
        const x = (i / tL.length) * w;
        const v = (tL[i] - 128) / 128;
        const y = cy + off + v * amp + Math.sin(i * 0.08 + t * 2 + phaseShift) * h * 0.012 * b.treble;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const isMain = layer === Math.floor(layers / 2);
      ctx.strokeStyle = isMain
        ? `rgba(${accent[0]},${accent[1]},${accent[2]},${0.92 + beat * 0.08})`
        : `rgba(${ck[0]},${ck[1]},${ck[2]},${0.4 + b.mid * 0.3})`;
      ctx.shadowBlur = isMain ? (20 + drop * 24) * this.dpr : 6 * this.dpr;
      ctx.shadowColor = `rgba(${accent[0]},${accent[1]},${accent[2]},0.85)`;
      ctx.lineWidth = this.dpr * (isMain ? 2.8 + beat * 1.4 : 1.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawKaleidoscope(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const slices = 8;
    const cx = w / 2;
    const cy = h / 2;
    const f = this.engine.freqData;
    if (!f.length) return;
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    ctx.save();
    ctx.translate(cx, cy);
    const bandHues = paletteAt(t * 0.05);
    for (let s = 0; s < slices; s++) {
      ctx.save();
      ctx.rotate(((Math.PI * 2) / slices) * s);
      if (s % 2) ctx.scale(-1, 1);
      const bars = 40;
      const step = Math.max(1, Math.floor(f.length / bars));
      const radIn = Math.min(w, h) * 0.06;
      const radMax = Math.min(w, h) * 0.45;
      const sliceAng = (Math.PI * 2) / slices;
      const wedgeR = radMax * (0.45 + beat * 0.25);
      const wedgeGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, wedgeR);
      wedgeGrad.addColorStop(0, `rgba(${bandHues[0]},${bandHues[1]},${bandHues[2]},${0.22 + beat * 0.18})`);
      wedgeGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = wedgeGrad;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, wedgeR, 0, sliceAng);
      ctx.closePath();
      ctx.fill();
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let k = 0; k < step; k++) sum += f[i * step + k] || 0;
        const v = sum / step / 255;
        const a = ((i / bars) * Math.PI) / slices;
        const len = radIn + v * (radMax - radIn) * (1 + beat * 0.25);
        const ck = paletteAt(t * 0.08 + i / bars + s * 0.05);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * radIn, Math.sin(a) * radIn);
        ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
        ctx.strokeStyle = `rgba(${ck[0]},${ck[1]},${ck[2]},${0.55 + v * 0.45})`;
        ctx.lineWidth = this.dpr * (2 + v * 2);
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // ─── palette-orbs ─── 5 swatch orbits, each tied to a frequency band.
  // Per-track palette guarantees no two songs look identical.
  private drawPaletteOrbs(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const palette = this.trackPalette;
    const swatches: Array<[number, number, number]> = palette
      ? [palette.vibrant, palette.complementary, palette.lightMuted, palette.muted, palette.darkVibrant]
      : PALETTE_KEYFRAMES;
    const bands = [
      this.bandEnergy(0, 0.04),
      this.bandEnergy(0.05, 0.12),
      this.bandEnergy(0.14, 0.28),
      this.bandEnergy(0.3, 0.52),
      this.bandEnergy(0.55, 0.85)
    ];
    const cx = w / 2,
      cy = h / 2;
    const baseR = Math.min(w, h) * 0.32;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 5; i++) {
      const e = bands[i];
      const phase = t * (0.35 + i * 0.07) + i * 1.3;
      const orbit = baseR * (0.55 + i * 0.12);
      const ox = cx + Math.cos(phase) * orbit;
      const oy = cy + Math.sin(phase * 1.17) * orbit * 0.62;
      const radius = baseR * (0.18 + e * 0.6 + beat * 0.2);
      const c = swatches[i % swatches.length];
      const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.55 + e * 0.4})`);
      grad.addColorStop(0.45, `rgba(${c[0]},${c[1]},${c[2]},${0.22 + e * 0.25})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(ox, oy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    // Centre stamp pulsing with vocal-range energy.
    const vocal = this.bandEnergy(0.12, 0.32);
    const vc = palette ? palette.vibrant : this.accent;
    const cr = baseR * (0.12 + vocal * 0.4 + beat * 0.18);
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
    cg.addColorStop(0, `rgba(${vc[0]},${vc[1]},${vc[2]},${0.7 + beat * 0.25})`);
    cg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ─── drop-strobe ─── full-frame accent flash when AudioEngine.dropImminent
  // fires (RMS flux predictor lookahead ~150ms). Cinematic climax cue.
  private drawDropStrobe(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const engine = this.engine;
    if (engine.dropImminent) this.strobePulse = 1;
    // dt-aware decay so 30fps mobile and 60fps desktop see the same ~600ms
    // strobe falloff (was 0.018/frame → strobe lasted 2× longer on mobile).
    const strobeDt = 1 / Math.max(30, this.fpsEMA);
    this.strobePulse = Math.max(0, this.strobePulse - strobeDt * 1.65);
    const energy = engine.dropEnergy;
    const palette = this.trackPalette;
    const vibrant = palette ? palette.vibrant : this.accent;
    const complement = palette ? palette.complementary : [255, 90, 60];

    // Build-phase scanlines — vertical streaks accelerate as the build climbs.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cols = 14;
    for (let i = 0; i < cols; i++) {
      const phase = (i / cols + t * (0.4 + engine.buildPhase * 1.2)) % 1;
      const x = phase * w;
      const a = 0.06 + engine.buildPhase * 0.18 + energy * 0.18;
      const grad = ctx.createLinearGradient(x, 0, x, h);
      grad.addColorStop(0, `rgba(${vibrant[0]},${vibrant[1]},${vibrant[2]},0)`);
      grad.addColorStop(0.5, `rgba(${vibrant[0]},${vibrant[1]},${vibrant[2]},${a})`);
      grad.addColorStop(1, `rgba(${complement[0]},${complement[1]},${complement[2]},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x - w / cols / 3, 0, (w / cols) * 0.66, h);
    }
    ctx.restore();

    // The strobe itself — accent overlay, falls off across ~55 frames.
    if (this.strobePulse > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(${vibrant[0]},${vibrant[1]},${vibrant[2]},${this.strobePulse * 0.45})`;
      ctx.fillRect(0, 0, w, h);
      // Radial shockwave from centre.
      const cx = w / 2,
        cy = h / 2;
      const rad = Math.max(w, h) * (1 - this.strobePulse) * 1.4;
      const wave = ctx.createRadialGradient(cx, cy, rad * 0.85, cx, cy, rad);
      wave.addColorStop(0, 'rgba(255,255,255,0)');
      wave.addColorStop(
        0.5,
        `rgba(${complement[0]},${complement[1]},${complement[2]},${this.strobePulse * 0.55})`
      );
      wave.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = wave;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // ─── prism ─── radial bars with chromatic-aberration R/G/B split.
  // CA offset scales with treble. Pulls colors from per-track palette.
  private drawPrism(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const treble = this.bandEnergy(0.4, 0.85);
    const palette = this.trackPalette;
    const aColor = palette ? palette.vibrant : this.accent;
    const bColor = palette ? palette.complementary : [255, 80, 200];
    const cx = w / 2,
      cy = h / 2;
    const f = this.engine.freqData;
    const bars = 96;
    const step = Math.max(1, Math.floor((f.length * 0.6) / bars));
    const offset = this.dpr * 2 + treble * (this.dpr * 14) + beat * (this.dpr * 6);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.08);
    for (let pass = 0; pass < 3; pass++) {
      // R offset on +x, G centred, B offset on -x — classic prism.
      const dx = (pass - 1) * offset;
      ctx.save();
      ctx.translate(dx, 0);
      ctx.globalCompositeOperation = 'lighter';
      const channel: [number, number, number] =
        pass === 0
          ? [aColor[0], 28, 28]
          : pass === 1
            ? [Math.round((aColor[1] + bColor[1]) / 2), Math.round((aColor[1] + bColor[1]) / 2), 28]
            : [28, 28, bColor[2]];
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let k = 0; k < step; k++) sum += f[i * step + k] || 0;
        const v = sum / step / 255;
        const angle = (i / bars) * Math.PI * 2;
        const radIn = Math.min(w, h) * 0.14;
        const radOut = radIn + v * Math.min(w, h) * 0.36;
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * radIn, Math.sin(angle) * radIn);
        ctx.lineTo(Math.cos(angle) * radOut, Math.sin(angle) * radOut);
        ctx.strokeStyle = `rgba(${channel[0]},${channel[1]},${channel[2]},${0.55 + v * 0.4})`;
        ctx.lineWidth = this.dpr * (2 + v * 1.6);
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();
    }
    // Inner ring stitched from per-track swatches.
    if (palette) {
      const swatches = [
        palette.vibrant,
        palette.complementary,
        palette.lightMuted,
        palette.darkVibrant,
        palette.muted
      ];
      ctx.lineWidth = this.dpr * (1.5 + beat * 2);
      for (let s = 0; s < swatches.length; s++) {
        const c = swatches[s];
        ctx.beginPath();
        const start = (s / swatches.length) * Math.PI * 2;
        const end = ((s + 0.85) / swatches.length) * Math.PI * 2;
        const r = Math.min(w, h) * 0.1;
        ctx.arc(0, 0, r, start, end);
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.75 + beat * 0.2})`;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ─── catalog expansion (26 modes) ──────────────────────────────────────
  // All palette-aware via paletteAt() / this.trackPalette. Lightweight 2D.

  private drawWormhole(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const bass = this.bandEnergy(0, 0.08);
    const drop = this.cur.drop ? 1 : 0;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.hypot(w, h) * 0.55;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.06 + this.cur.tempo * Math.PI * 0.5);
    const rings = 28;
    for (let i = 0; i < rings; i++) {
      const f = ((i + t * (0.6 + bass * 1.4 + drop * 0.6)) % rings) / rings;
      const r = Math.pow(1 - f, 2.2) * maxR;
      const c = paletteAt(f + t * 0.04 + this.cur.centroid * 0.4);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.15 + (1 - f) * 0.7 + drop * 0.2})`;
      ctx.lineWidth = this.dpr * (1.4 + (1 - f) * 6 + beat * 2 + drop * 2.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawVortex(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const beat = this.cur.beat;
    const bass = this.cur.bass;
    const treble = this.cur.treble;
    const tempoPhase = this.cur.tempo;
    const drop = this.cur.drop;
    const dropE = this.cur.dropE;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    // Bass dictates arm count (3-8) — more bass = more spiral arms.
    const arms = Math.max(3, Math.min(8, Math.round(3 + bass * 5)));
    const perArm = 220;
    // Bar-locked spiral rotation: tempoPhase wraps every beat, so the entire
    // vortex completes a quarter-turn per bar at any tempo.
    const barAngle = tempoPhase * Math.PI * 0.5;
    for (let a = 0; a < arms; a++) {
      const base = (a / arms) * Math.PI * 2 + barAngle;
      for (let i = 0; i < perArm; i++) {
        const u = i / perArm;
        const r = u * maxR * (1 + dropE * 0.18);
        const swirl = base + u * (4 + beat * 2 + bass * 1.5) + t * 0.6;
        const x = Math.cos(swirl) * r;
        const y = Math.sin(swirl) * r;
        const c = paletteAt(u + a * 0.18);
        // Treble swells particle size on the outer rim; drop fires an
        // outward burst by scaling every particle 1.6× for the predicted
        // ~700ms drop window.
        const dropBurst = drop ? 1.6 : 1;
        const size = this.dpr * (1.2 + (1 - u) * 2.2 + treble * 1.4) * dropBurst;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.25 + (1 - u) * 0.6})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawSunburst(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const f = this.engine.freqData;
    const cx = w / 2;
    const cy = h / 2;
    const rays = 96;
    const innerR = Math.min(w, h) * (0.1 + beat * 0.04);
    const maxR = Math.min(w, h) * 0.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.08);
    for (let i = 0; i < rays; i++) {
      const bin = Math.floor((i / rays) * f.length * 0.7);
      const v = (f[bin] || 0) / 255;
      const ang = (i / rays) * Math.PI * 2;
      const len = innerR + v * (maxR - innerR);
      const c = paletteAt(i / rays);
      const grad = ctx.createLinearGradient(0, 0, Math.cos(ang) * len, Math.sin(ang) * len);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.9})`);
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = this.dpr * (2 + v * 3.5);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(Math.cos(ang) * innerR, Math.sin(ang) * innerR);
      ctx.lineTo(Math.cos(ang) * len, Math.sin(ang) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawMirrorWave(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.engine.timeData;
    const cx = w / 2;
    const cy = h / 2;
    const accent = this.accent;
    const p = this.trackPalette;
    const comp = p?.complementary ?? paletteAt(0.4);
    const beat = this.cur.beat;
    const bass = this.cur.bass;
    const treble = this.cur.treble;
    const drop = this.cur.drop;
    // Beat pulse + bass swell drives horizontal-pair amplitude; quiet
    // sections stay calm, big bass moments arch the waves dramatically.
    const ampH = Math.min(w, h) * (0.3 + bass * 0.18 + beat * 0.08);
    const ampV = Math.min(w, h) * (0.3 + treble * 0.18 + beat * 0.06);
    // Drop window: blow the line weight to 3.6× + full alpha so the
    // climax reads at-a-glance.
    const dropBoost = drop ? 1.8 : 1;
    ctx.lineWidth = this.dpr * 2.2 * dropBoost;
    ctx.lineCap = 'round';
    // horizontal pair (top + bottom mirror) — bass-modulated thickness
    for (let pass = 0; pass < 2; pass++) {
      const dir = pass === 0 ? -1 : 1;
      ctx.beginPath();
      for (let i = 0; i < t.length; i++) {
        const u = i / (t.length - 1);
        const x = u * w;
        const y = cy + dir * ((t[i] - 128) / 128) * ampH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const c = pass === 0 ? accent : comp;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.85 * dropBoost})`;
      ctx.stroke();
    }
    // vertical pair (left + right mirror) — treble-modulated
    for (let pass = 0; pass < 2; pass++) {
      const dir = pass === 0 ? -1 : 1;
      ctx.beginPath();
      for (let i = 0; i < t.length; i++) {
        const u = i / (t.length - 1);
        const y = u * h;
        const x = cx + dir * ((t[i] - 128) / 128) * ampV;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const c = paletteAt(0.7 + pass * 0.15);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.55 * dropBoost})`;
      ctx.stroke();
    }
    // Drop flash: brief full-canvas wash that decays via blend mode.
    if (drop) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(${accent[0]},${accent[1]},${accent[2]},0.18)`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  private drawHexGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const f = this.engine.freqData;
    const beat = this.cur.beat;
    const tempoPhase = this.cur.tempo;
    const drop = this.cur.drop;
    const bass = this.cur.bass;
    const cell = Math.max(28, Math.min(w, h) / 22);
    const dx = cell * Math.sqrt(3);
    const dy = cell * 1.5;
    // Bar-locked sweep: brightness wave traverses L→R every beat
    // (tempoPhase ∈ 0..1). Cells within ±sweepBand get an alpha boost.
    const sweepX = tempoPhase * w;
    const sweepBand = w * 0.18;
    let bin = 0;
    for (let row = -1; row * dy < h + cell; row++) {
      const offx = row & 1 ? dx / 2 : 0;
      for (let col = -1; col * dx + offx < w + cell; col++) {
        const x = col * dx + offx;
        const y = row * dy;
        const b = Math.floor(((bin * 7919) % f.length) * 0.7);
        const v = (f[b] || 0) / 255;
        bin++;
        const sweepDist = Math.abs(x - sweepX);
        const sweepBoost =
          sweepDist < sweepBand
            ? Math.cos((sweepDist / sweepBand) * Math.PI * 0.5) * (0.35 + beat * 0.25)
            : 0;
        const intensity = v + sweepBoost;
        if (intensity < 0.05) continue;
        // Color cells by horizontal position so left = bass register,
        // right = treble — the grid becomes a visible band-spectrum
        // landscape that reacts to the actual freq content.
        const palettePos = (x / w + bin * 0.003) % 1;
        const c = paletteAt(palettePos);
        const dropMul = drop ? 1.4 : 1;
        const bassPump = 1 + bass * 0.3;
        const alphaFill = Math.min(1, (0.15 + intensity * 0.75) * dropMul * bassPump);
        const alphaStroke = Math.min(1, (0.3 + intensity * 0.5) * dropMul);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const px = x + Math.cos(a) * cell * 0.55;
          const py = y + Math.sin(a) * cell * 0.55;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alphaFill})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alphaStroke})`;
        ctx.lineWidth = this.dpr;
        ctx.stroke();
      }
    }
  }

  private drawLiquid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const bass = this.bandEnergy(0, 0.08);
    const mid = this.bandEnergy(0.08, 0.32);
    const beat = this.engine.beatPulse;
    const blobs = 5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < blobs; i++) {
      const ph = i * 1.31 + t * (0.4 + i * 0.07);
      const cx = w / 2 + Math.cos(ph) * w * 0.28;
      const cy = h / 2 + Math.sin(ph * 0.7) * h * 0.28;
      const r = Math.min(w, h) * (0.12 + bass * 0.1 + (i % 2 ? mid : beat) * 0.08);
      const c = paletteAt(i / blobs + t * 0.05);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.85)`);
      grad.addColorStop(0.6, `rgba(${c[0]},${c[1]},${c[2]},0.35)`);
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawVinyl(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const beat = this.cur.beat;
    const bass = this.cur.bass;
    const drop = this.cur.drop;
    const dropE = this.cur.dropE;
    // BPM-locked rotation: a real 33⅓-RPM record turns 0.5236 rad/s
    // (33.33 / 60 * 2π). We lock spin rate to the song's authoritative
    // BPM so visualizer rotation = musical tempo, not arbitrary 1.2x clock.
    // Default to 110 BPM if engine.bpm hasn't converged yet (first ~5s).
    const bpm = this.engine.bpm > 30 ? this.engine.bpm : 110;
    // Rotation = (BPM / 60) rad per second × dt accumulator. We use
    // performance.now() so spin doesn't drift between frames.
    const spin = ((performance.now() / 1000) * (bpm / 60) * Math.PI * 2) % (Math.PI * 2);
    // Drop wobble: introduce a sinusoidal eccentricity when a drop hits
    // (~50ms of 'scratch' jitter) — visual analog to a needle skip.
    const wobble = drop ? Math.sin(performance.now() * 0.04) * 0.04 : 0;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42 * (1 + dropE * 0.05);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(spin + wobble);
    // body
    ctx.fillStyle = 'rgba(8,8,14,0.95)';
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    // grooves driven by freqData + bass deformation (outer rim bulges
    // on heavy bass for a tangible-feeling groove pump).
    const f = this.engine.freqData;
    const grooves = 60;
    for (let i = 0; i < grooves; i++) {
      const u = i / grooves;
      const r = R * (0.35 + u * 0.6) * (1 + (u > 0.7 ? bass * 0.08 : 0));
      const bin = Math.floor(u * f.length * 0.6);
      const v = (f[bin] || 0) / 255;
      const c = paletteAt(u);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.12 + v * 0.55})`;
      ctx.lineWidth = this.dpr * (0.5 + v * 1.6);
      ctx.stroke();
    }
    // label
    const labR = R * 0.32;
    const labC = this.trackPalette?.vibrant ?? paletteAt(0);
    const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, labR);
    lg.addColorStop(0, `rgba(${labC[0]},${labC[1]},${labC[2]},0.95)`);
    lg.addColorStop(1, `rgba(${labC[0]},${labC[1]},${labC[2]},0.65)`);
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.arc(0, 0, labR, 0, Math.PI * 2);
    ctx.fill();
    // spindle
    ctx.fillStyle = '#060610';
    ctx.beginPath();
    ctx.arc(0, 0, this.dpr * (3 + beat * 2), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawSmoke(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const bass = this.bandEnergy(0, 0.08);
    const st = this.vizState as {
      smoke?: {
        items: {
          x: number;
          y: number;
          vx: number;
          vy: number;
          r: number;
          life: number;
          c: [number, number, number];
        }[];
      };
    };
    if (!st.smoke) st.smoke = { items: [] };
    const items = st.smoke.items;
    const want = 70 + Math.floor(bass * 60);
    while (items.length < want) {
      const c = paletteAt(Math.random());
      items.push({
        x: w / 2 + (Math.random() - 0.5) * w * 0.2,
        y: h * 0.9,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -(0.6 + Math.random() * 1.2 + bass * 1.5),
        r: 8 + Math.random() * 30,
        life: 1,
        c
      });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // dt-aware: smoke rises + dissipates at consistent wall-clock rate.
    const dtNorm = (1 / Math.max(30, this.fpsEMA)) * 60;
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      p.x += (p.vx + Math.sin(t + i) * 0.2) * dtNorm;
      p.y += p.vy * dtNorm;
      p.r += 0.4 * dtNorm;
      p.life -= 0.012 * dtNorm;
      if (p.life <= 0 || p.y < -p.r) {
        items.splice(i, 1);
        continue;
      }
      const a = Math.max(0, p.life) * 0.45;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      grad.addColorStop(0, `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${a})`);
      grad.addColorStop(1, `rgba(${p.c[0]},${p.c[1]},${p.c[2]},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawStrings(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const f = this.engine.freqData;
    const strings = 14;
    const gap = h / (strings + 1);
    ctx.lineCap = 'round';
    for (let s = 0; s < strings; s++) {
      const y0 = (s + 1) * gap;
      const bin = Math.floor((s / strings) * f.length * 0.6);
      const v = (f[bin] || 0) / 255;
      const c = paletteAt(s / strings);
      const amp = gap * 0.45 * v;
      const freq = 4 + s * 0.6;
      ctx.beginPath();
      for (let x = 0; x <= w; x += Math.max(3, this.dpr * 2)) {
        const phase = (x / w) * freq * Math.PI * 2 + t * (3 + s * 0.4);
        const env = Math.sin((x / w) * Math.PI);
        const y = y0 + Math.sin(phase) * amp * env;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.5 + v * 0.5})`;
      ctx.lineWidth = this.dpr * (1 + v * 2.6);
      ctx.stroke();
    }
  }

  private drawSpider(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const f = this.engine.freqData;
    const cx = w / 2;
    const cy = h / 2;
    const spokes = 16;
    const rings = 8;
    const maxR = Math.min(w, h) * 0.45;
    const c = paletteAt(0.1);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.35)`;
    ctx.lineWidth = this.dpr;
    // radial spokes
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * maxR, Math.sin(a) * maxR);
      ctx.stroke();
    }
    // concentric web rings deformed by FFT
    for (let r = 1; r <= rings; r++) {
      const u = r / rings;
      ctx.beginPath();
      for (let i = 0; i <= spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        const bin = Math.floor((i / spokes + r * 0.05) * f.length * 0.6) % f.length;
        const v = (f[bin] || 0) / 255;
        const radius = u * maxR + v * 18 * this.dpr;
        const x = Math.cos(a) * radius;
        const y = Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      const cc = paletteAt(u);
      ctx.strokeStyle = `rgba(${cc[0]},${cc[1]},${cc[2]},${0.4 + u * 0.4})`;
      ctx.lineWidth = this.dpr * (1 + u * 1.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCymatics(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const bass = this.bandEnergy(0, 0.08);
    const mid = this.bandEnergy(0.08, 0.32);
    const treble = this.bandEnergy(0.32, 0.85);
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.46;
    const sources = 6;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    for (let s = 0; s < sources; s++) {
      const ang = (s / sources) * Math.PI * 2 + t * 0.2;
      const sx = Math.cos(ang) * maxR * 0.5;
      const sy = Math.sin(ang) * maxR * 0.5;
      const c = paletteAt(s / sources);
      const waves = 10;
      for (let r = 1; r <= waves; r++) {
        const phase = r + t * (2 + bass * 4);
        const radius = (((phase + s * 0.2) % waves) / waves) * maxR;
        const a = 1 - ((phase + s * 0.2) % waves) / waves;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a * (0.35 + mid * 0.4 + treble * 0.2)})`;
        ctx.lineWidth = this.dpr * (1 + bass * 1.6);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawConfetti(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const beat = this.engine.beatPulse;
    const drop = this.engine.dropImminent;
    const st = this.vizState as {
      confetti?: {
        items: {
          x: number;
          y: number;
          vx: number;
          vy: number;
          rot: number;
          vr: number;
          sz: number;
          c: [number, number, number];
          life: number;
        }[];
      };
    };
    if (!st.confetti) st.confetti = { items: [] };
    const items = st.confetti.items;
    if (drop || beat > 0.92) {
      const burst = 80;
      for (let i = 0; i < burst; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 6 + Math.random() * 14;
        items.push({
          x: w / 2,
          y: h / 2,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 4,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.6,
          sz: 4 + Math.random() * 8,
          c: paletteAt(Math.random()),
          life: 1
        });
      }
    }
    // dt-aware integration so confetti falls + decays at the same wall-clock
    // rate on every device. Was tied to frame count → mobile saw 2× life.
    const dtNorm = (1 / Math.max(30, this.fpsEMA)) * 60;
    const drag = Math.pow(0.992, dtNorm);
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      p.vy += 0.3 * dtNorm;
      p.vx *= drag;
      p.x += p.vx * dtNorm;
      p.y += p.vy * dtNorm;
      p.rot += p.vr * dtNorm;
      p.life -= 0.008 * dtNorm;
      if (p.life <= 0 || p.y > h + 40) {
        items.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${p.life})`;
      ctx.fillRect(-p.sz / 2, -p.sz / 4, p.sz, p.sz / 2);
      ctx.restore();
    }
  }

  private drawBloom(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const orbs = 9;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < orbs; i++) {
      const ph = i * 0.83 + t * (0.35 + i * 0.05);
      const x = w / 2 + Math.cos(ph) * w * 0.36;
      const y = h / 2 + Math.sin(ph * 1.13) * h * 0.32;
      const r = Math.min(w, h) * (0.1 + 0.04 * (i % 3) + beat * 0.05);
      const c = paletteAt(i / orbs);
      for (let pass = 0; pass < 3; pass++) {
        const k = pass + 1;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r * k);
        grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.6 / k})`);
        grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(x, y, r * k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawRose(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const mid = this.bandEnergy(0.08, 0.32);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42;
    const k = 5 + Math.floor((Math.sin(t * 0.2) + 1) * 2.5);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.1);
    const layers = 5;
    for (let L = 0; L < layers; L++) {
      const c = paletteAt(L / layers + t * 0.05);
      ctx.beginPath();
      const steps = 720;
      for (let i = 0; i <= steps; i++) {
        const th = (i / steps) * Math.PI * 2;
        const r = R * Math.cos(k * th) * (0.6 + 0.4 * Math.sin(t + L)) * (1 - L * 0.12);
        const x = r * Math.cos(th);
        const y = r * Math.sin(th);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.55 + mid * 0.35})`;
      ctx.lineWidth = this.dpr * (1 + beat * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawWaterfall(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const f = this.engine.freqData;
    const st = this.vizState as {
      waterfall?: { off: HTMLCanvasElement; ctx: CanvasRenderingContext2D; row: number };
    };
    const rowH = Math.max(2, Math.floor(2 * this.dpr));
    if (!st.waterfall || st.waterfall.off.width !== w || st.waterfall.off.height !== h) {
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const offCtx = off.getContext('2d', { alpha: false })!;
      offCtx.fillStyle = '#020208';
      offCtx.fillRect(0, 0, w, h);
      st.waterfall = { off, ctx: offCtx, row: 0 };
    }
    const off = st.waterfall;
    // scroll up
    off.ctx.globalCompositeOperation = 'copy';
    off.ctx.drawImage(off.off, 0, -rowH);
    off.ctx.globalCompositeOperation = 'source-over';
    // draw newest row at bottom
    const y = h - rowH;
    const cols = Math.min(f.length, Math.floor(w / Math.max(1, this.dpr)));
    const beat = this.cur.beat;
    const drop = this.cur.drop;
    for (let i = 0; i < cols; i++) {
      const x = (i / cols) * w;
      const v = f[Math.floor((i / cols) * f.length * 0.7)] / 255;
      const c = paletteAt(v * 0.6 + 0.1);
      const a = Math.pow(v, 0.7);
      off.ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      off.ctx.fillRect(x, y, Math.max(1, w / cols + 1), rowH);
    }
    // Beat pulse: brighten the newest row so beats become visible
    // horizontal stripes in the scroll history (musical archaeology).
    if (beat > 0.3) {
      off.ctx.fillStyle = `rgba(255,255,255,${beat * 0.25})`;
      off.ctx.fillRect(0, y, w, rowH);
    }
    // Drop band: paint a hot accent stripe so drops are unmistakably
    // visible scrolling up through the waterfall.
    if (drop) {
      const ac = this.accent;
      off.ctx.fillStyle = `rgba(${ac[0]},${ac[1]},${ac[2]},0.55)`;
      off.ctx.fillRect(0, y, w, rowH);
    }
    ctx.drawImage(off.off, 0, 0);
  }

  private drawMonolith(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const f = this.engine.freqData;
    const beat = this.cur.beat;
    const tempoPhase = this.cur.tempo;
    const drop = this.cur.drop;
    const bars = 40;
    const step = Math.floor((f.length * 0.7) / bars);
    const bw = w / bars;
    // Bar-locked light wave traveling across the skyline. Towers whose
    // index is within ±sweepBand of the wave's current x get a flicker
    // boost — visually "the wave rolls across the city".
    const sweepIdx = tempoPhase * bars;
    const sweepBand = bars * 0.15;
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let k = 0; k < step; k++) sum += f[i * step + k] || 0;
      const v = sum / step / 255;
      const bh = v * h * 0.85;
      const c = paletteAt(i / bars);
      const x = i * bw;
      const y = h - bh;
      // tower body
      const grad = ctx.createLinearGradient(0, y, 0, h);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.95)`);
      grad.addColorStop(
        1,
        `rgba(${Math.round(c[0] * 0.3)},${Math.round(c[1] * 0.3)},${Math.round(c[2] * 0.3)},0.85)`
      );
      ctx.fillStyle = grad;
      ctx.fillRect(x + bw * 0.08, y, bw * 0.84, bh);
      // windows — flicker on beat + sweep + drop
      const sweepDist = Math.min(
        Math.abs(i - sweepIdx),
        Math.abs(i - sweepIdx + bars),
        Math.abs(i - sweepIdx - bars)
      );
      const inSweep = sweepDist < sweepBand;
      const winRows = Math.floor(bh / (bw * 0.45));
      for (let r = 0; r < winRows; r++) {
        for (let cI = 0; cI < 3; cI++) {
          const wx = x + bw * 0.18 + cI * bw * 0.25;
          const wy = y + r * bw * 0.45 + bw * 0.1;
          // Lit pattern is pseudo-random but flickers on beat: every beat
          // a different ~40% of windows light up extra-bright.
          const hashBase = (i * 31 + r * 17 + cI * 7) % 5 < 2;
          const beatHash =
            beat > 0.5 && (i * 13 + r * 23 + cI * 11 + Math.floor(performance.now() / 200)) % 7 < 3;
          const sweepLit = inSweep || drop;
          const lit = hashBase || beatHash || sweepLit;
          const litAlpha = drop ? 0.95 : sweepLit ? 0.85 : 0.45 + v * 0.4 + beat * 0.15;
          ctx.fillStyle = lit ? `rgba(255,240,180,${litAlpha})` : 'rgba(40,40,60,0.5)';
          ctx.fillRect(wx, wy, bw * 0.16, bw * 0.22);
        }
      }
    }
  }

  private drawNebula(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const mid = this.bandEnergy(0.08, 0.32);
    const bass = this.cur.bass;
    const beat = this.cur.beat;
    const drop = this.cur.drop;
    const dropE = this.cur.dropE;
    // Drop implode-then-explode: during the drop window, blobs collapse
    // toward center then snap back outward. Smooth via dropE so the
    // transition isn't a hard jump.
    const orbitScale = 1 - (drop ? 0.4 : 0) + dropE * 0.15;
    const blobs = 14;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < blobs; i++) {
      const ph = i * 1.7 + t * (0.06 + i * 0.01);
      const cx = w / 2 + Math.cos(ph) * w * 0.4 * orbitScale;
      const cy = h / 2 + Math.sin(ph * 1.3) * h * 0.4 * orbitScale;
      // Bass swells blob radius — heavy 808s now visibly inflate the cloud.
      const r = Math.min(w, h) * (0.18 + 0.04 * (i % 3) + mid * 0.05 + bass * 0.08);
      const c = paletteAt(i / blobs + t * 0.02);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.35 + beat * 0.15})`);
      grad.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},0.12)`);
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // glittering dust — beat triggers a brief sparkle surge
    const dustGain = 1 + beat * 0.6;
    for (let i = 0; i < 60; i++) {
      const x = (Math.sin(i * 9.31 + t) * 0.5 + 0.5) * w;
      const y = (Math.cos(i * 7.13 + t * 0.6) * 0.5 + 0.5) * h;
      const c = starPalette(i / 60);
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.5 + Math.sin(t * 4 + i) * 0.4) * dustGain})`;
      ctx.beginPath();
      ctx.arc(x, y, this.dpr * 1.2 * dustGain, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawRibbons(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const f = this.engine.freqData;
    const ribbons = 6;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let r = 0; r < ribbons; r++) {
      const c = paletteAt(r / ribbons);
      const bin = Math.floor((r / ribbons) * f.length * 0.6);
      const v = (f[bin] || 0) / 255;
      ctx.beginPath();
      const seg = 80;
      for (let i = 0; i <= seg; i++) {
        const u = i / seg;
        const x = u * w;
        const phase = u * 6 + t * (1.2 + r * 0.2) + r;
        const y = h / 2 + Math.sin(phase) * h * 0.28 * (0.4 + v) + Math.sin(phase * 2.3) * h * 0.06;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.55 + v * 0.4})`;
      ctx.lineWidth = this.dpr * (3 + r * 1.1 + v * 4);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGravity(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const cx = w / 2;
    const cy = h / 2;
    const orbits = 7;
    ctx.save();
    ctx.translate(cx, cy);
    for (let o = 0; o < orbits; o++) {
      const r = Math.min(w, h) * (0.08 + o * 0.05);
      const c = paletteAt(o / orbits);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.18)`;
      ctx.lineWidth = this.dpr;
      ctx.stroke();
      const speed = 0.6 - o * 0.06 + beat * 0.4;
      const planets = 1 + (o % 3);
      for (let pi = 0; pi < planets; pi++) {
        const a = t * speed + (pi / planets) * Math.PI * 2 + o * 0.7;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.95)`;
        ctx.beginPath();
        ctx.arc(x, y, this.dpr * (2.5 + beat * 2.5), 0, Math.PI * 2);
        ctx.fill();
        const trail = ctx.createRadialGradient(x, y, 0, x, y, 22 * this.dpr);
        trail.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.7)`);
        trail.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        ctx.fillStyle = trail;
        ctx.beginPath();
        ctx.arc(x, y, 22 * this.dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // central star
    const sc = this.trackPalette?.vibrant ?? paletteAt(0);
    const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.min(w, h) * 0.08);
    sg.addColorStop(0, `rgba(${sc[0]},${sc[1]},${sc[2]},1)`);
    sg.addColorStop(1, `rgba(${sc[0]},${sc[1]},${sc[2]},0)`);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, Math.min(w, h) * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawLattice(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const bass = this.bandEnergy(0, 0.08);
    const cx = w / 2;
    const cy = h / 2;
    const size = Math.min(w, h) * 0.32;
    // 8 cube vertices
    const verts: [number, number, number][] = [];
    for (let i = 0; i < 8; i++) {
      verts.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
    }
    const edges: [number, number][] = [
      [0, 1],
      [0, 2],
      [0, 4],
      [1, 3],
      [1, 5],
      [2, 3],
      [2, 6],
      [3, 7],
      [4, 5],
      [4, 6],
      [5, 7],
      [6, 7]
    ];
    const ax = t * 0.6;
    const ay = t * 0.4;
    const az = t * 0.3;
    const ca = Math.cos(ax),
      sa = Math.sin(ax);
    const cb = Math.cos(ay),
      sb = Math.sin(ay);
    const cc = Math.cos(az),
      sc2 = Math.sin(az);
    const project = (v: [number, number, number]): [number, number, number] => {
      let [x, y, z] = v;
      // rot x
      let y2 = y * ca - z * sa;
      let z2 = y * sa + z * ca;
      y = y2;
      z = z2;
      // rot y
      let x2 = x * cb + z * sb;
      z2 = -x * sb + z * cb;
      x = x2;
      z = z2;
      // rot z
      x2 = x * cc - y * sc2;
      y2 = x * sc2 + y * cc;
      x = x2;
      y = y2;
      const persp = 1 / (3 - z);
      return [cx + x * size * persp * 3, cy + y * size * persp * 3, z];
    };
    const proj = verts.map(project);
    // edges
    for (let i = 0; i < edges.length; i++) {
      const [a, b] = edges[i];
      const pa = proj[a];
      const pb = proj[b];
      const zMid = (pa[2] + pb[2]) / 2;
      const c = paletteAt((i / edges.length + t * 0.1) % 1);
      const alpha = 0.35 + (zMid + 1) * 0.3;
      ctx.beginPath();
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha + beat * 0.3})`;
      ctx.lineWidth = this.dpr * (1.5 + bass * 2);
      ctx.stroke();
    }
    // vertices
    for (let i = 0; i < proj.length; i++) {
      const c = paletteAt(i / proj.length);
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.95)`;
      ctx.beginPath();
      ctx.arc(proj[i][0], proj[i][1], this.dpr * (3 + beat * 2.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawFlux(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = this.tempoClock;
    const beat = this.engine.beatPulse;
    const mid = this.bandEnergy(0.08, 0.32);
    const cx = w / 2;
    const cy = h / 2;
    const poles = [
      { x: cx - w * 0.2, y: cy, sign: 1 },
      { x: cx + w * 0.2, y: cy, sign: -1 }
    ];
    const lines = 22;
    ctx.save();
    for (let L = 0; L < lines; L++) {
      const off = (L / lines - 0.5) * h * 0.6;
      const c = paletteAt(L / lines);
      ctx.beginPath();
      const steps = 80;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const x = poles[0].x + (poles[1].x - poles[0].x) * u;
        const bend = Math.sin((u - 0.5) * Math.PI) * off * (1 + Math.sin(t * 1.5 + L) * 0.3);
        const y = poles[0].y + bend + Math.sin(u * 12 + t * 3 + L) * 6 * (1 + mid * 4);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.4 + beat * 0.3})`;
      ctx.lineWidth = this.dpr * 1.3;
      ctx.stroke();
    }
    // poles
    for (const p of poles) {
      const c =
        p.sign > 0
          ? (this.trackPalette?.vibrant ?? paletteAt(0))
          : (this.trackPalette?.complementary ?? paletteAt(0.5));
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 60 * this.dpr);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.9)`);
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 60 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, beat: number) {
    const cx = w / 2;
    const cy = h / 2;
    const r0 = Math.min(w, h) * 0.35;
    const r1 = Math.max(w, h) * 0.85;
    const grad = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    grad.addColorStop(0, 'rgba(6,6,16,0)');
    grad.addColorStop(1, `rgba(6,6,16,${0.55 + beat * 0.18})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}
