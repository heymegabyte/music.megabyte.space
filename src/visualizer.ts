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
  const idx = ((t % 1) + 1) % 1 * n;
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

function paletteAt(t: number) { return lerpPalette(PALETTE_KEYFRAMES, t); }
function lovePalette(t: number) { return lerpPalette(LOVE_PALETTE, t); }
function starPalette(t: number) { return lerpPalette(STAR_PALETTE, t); }

export type VizMode =
  // new — the 14 beautiful ones
  | 'starfield'
  | 'constellation'
  | 'galaxy'
  | 'supernova'
  | 'aurora'
  | 'petals'
  | 'plasma'
  | 'mandala'
  | 'lightning'
  | 'fireflies'
  | 'bokeh'
  // existing
  | 'composite'
  | 'tunnel'
  | 'lissajous'
  | 'rings'
  | 'bars'
  | 'wave'
  | 'kaleidoscope'
  // palette-driven (per-track unique)
  | 'palette-orbs'     // 5 swatch orbits, each tied to a band
  | 'drop-strobe'      // accent flash on predicted drop
  | 'prism'            // chromatic-aberration radial bars
  // expansion catalog (per-track palette aware)
  | 'synthwave'        // perspective grid floor with sun
  | 'wormhole'         // recursive tunnel rings
  | 'vortex'           // spiral particle galaxy
  | 'sunburst'         // radial rays pulsing on beat
  | 'mirror-wave'      // symmetric quad-mirrored oscilloscope
  | 'hex-grid'         // hexagons lit by frequency cells
  | 'liquid'           // morphing metaballs
  | 'vinyl'            // spinning record + grooves
  | 'matrix'           // falling glyph rain
  | 'smoke'            // particle smoke
  | 'strings'          // vibrating spectrum strings
  | 'spider'           // radial web
  | 'cymatics'         // standing-wave interference
  | 'confetti'         // drop-triggered burst
  | 'bloom'            // soft glowing orbs
  | 'rose'             // rose-curve (rhodonea) spirograph
  | 'waterfall'        // 2D scrolling spectrogram
  | 'gem'              // refracting crystal facets
  | 'monolith'         // EQ cityscape
  | 'nebula'           // gas cloud blobs
  | 'swarm'            // boids flock
  | 'ribbons'          // flowing audio bands
  | 'starburst'        // sharp beat-burst particles
  | 'gravity'          // orbital particles
  | 'lattice'          // 3D rotating wireframe cube
  | 'flux';            // magnetic field lines

const MODE_ORDER: VizMode[] = [
  'starfield', 'constellation', 'galaxy', 'supernova', 'aurora',
  'petals',
  'plasma', 'mandala', 'lightning', 'fireflies', 'bokeh',
  'palette-orbs', 'drop-strobe', 'prism',
  'synthwave', 'wormhole', 'vortex', 'sunburst', 'mirror-wave',
  'hex-grid', 'liquid', 'vinyl', 'matrix', 'smoke', 'strings',
  'spider', 'cymatics', 'confetti', 'bloom', 'rose', 'waterfall',
  'gem', 'monolith', 'nebula', 'swarm', 'ribbons',
  'starburst', 'gravity', 'lattice', 'flux',
  'composite', 'tunnel', 'lissajous', 'rings', 'bars', 'wave', 'kaleidoscope'
];

// pure-dark background (no gradient blob field underneath)
const PURE_BG_MODES: Set<VizMode> = new Set([
  'starfield', 'constellation', 'galaxy', 'plasma', 'drop-strobe',
  'synthwave', 'wormhole', 'matrix', 'waterfall', 'lattice', 'monolith'
]);

type Star3D = { x: number; y: number; z: number; px: number; py: number };
type Star2D = { x: number; y: number; bin: number; tw: number };
type GalaxyParticle = { theta: number; r: number; size: number; color: [number, number, number] };
type SupernovaRing = { age: number; max: number; color: [number, number, number] };
type HeartItem = { x: number; vy: number; size: number; rot: number; vrot: number; sway: number; color: [number, number, number]; life: number };
type Bolt = { points: Array<[number, number]>; age: number; ttl: number; col: [number, number, number] };
type Firefly = { x: number; y: number; ax: number; ay: number; phase: number; rate: number; color: [number, number, number] };
type BokehItem = { x: number; y: number; size: number; vx: number; vy: number; color: [number, number, number]; alpha: number };
type LNode = { x: number; y: number };

export class Visualizer {
  private bg: HTMLCanvasElement;
  private bgCtx: CanvasRenderingContext2D;
  private engine: AudioEngine;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private rafId: number | null = null;
  private t0 = performance.now();
  private accent: [number, number, number] = [0, 229, 255];
  private mode: VizMode = 'starfield';
  private autoCycle = true;
  private lastCycleAt = 0;
  private fpsEMA = 60;
  private lastFrame = performance.now();
  private hudFreq = 0;
  private hudPeakBin = 0;
  private trail = false;
  private listeners = new Set<(m: VizMode) => void>();

  private vizState: {
    starfield?: { stars: Star3D[] };
    constellation?: { stars: Star2D[] };
    galaxy?: { particles: GalaxyParticle[] };
    supernova?: { rings: SupernovaRing[] };
    petals?: { items: HeartItem[] };
    plasma?: { off: HTMLCanvasElement; offCtx: CanvasRenderingContext2D; img: ImageData };
    lightning?: { bolts: Bolt[]; nodes: LNode[]; lastBeatAt: number };
    fireflies?: { items: Firefly[] };
    bokeh?: { items: BokehItem[] };
  } = {};

  constructor(bg: HTMLCanvasElement, engine: AudioEngine) {
    this.bg = bg;
    this.bgCtx = bg.getContext('2d', { alpha: true })!;
    this.engine = engine;
    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });
    this.prewarmHeavyState();
  }

  // Pre-init the particle systems that allocate non-trivial state on first
  // draw so switching modes mid-playback doesn't hitch the frame after the
  // switch. Lazy guards inside each draw method skip re-init.
  private prewarmHeavyState() {
    const starfield: Star3D[] = [];
    for (let i = 0; i < 260; i++) {
      starfield.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() * 0.99 + 0.01, px: 0, py: 0 });
    }
    this.vizState.starfield = { stars: starfield };

    const constStars: Star2D[] = [];
    for (let i = 0; i < 70; i++) {
      constStars.push({ x: Math.random(), y: Math.random(), bin: 5 + Math.floor(Math.random() * 200), tw: Math.random() * Math.PI * 2 });
    }
    this.vizState.constellation = { stars: constStars };

    const galaxy: GalaxyParticle[] = [];
    const arms = 4;
    const perArm = 180;
    for (let a = 0; a < arms; a++) {
      for (let i = 0; i < perArm; i++) {
        const tParam = (i + 1) / perArm;
        const armAngle = (a / arms) * Math.PI * 2;
        const spread = (Math.random() - 0.5) * 0.5;
        const theta = armAngle + tParam * Math.PI * 4 + spread;
        const r = 0.06 + tParam * 0.45 + (Math.random() - 0.5) * 0.04;
        galaxy.push({ theta, r, size: 0.4 + Math.random() * 1.8, color: starPalette(tParam * 0.6 + a * 0.13 + Math.random() * 0.2) });
      }
    }
    this.vizState.galaxy = { particles: galaxy };

    const off = document.createElement('canvas');
    off.width = 160; off.height = 90;
    const offCtx = off.getContext('2d', { willReadFrequently: true })!;
    const img = offCtx.createImageData(160, 90);
    this.vizState.plasma = { off, offCtx, img };

    const fireflies: Firefly[] = [];
    for (let i = 0; i < 60; i++) {
      fireflies.push({
        x: Math.random(), y: Math.random(),
        ax: Math.random() * Math.PI * 2, ay: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2, rate: 0.4 + Math.random() * 1.4,
        color: lovePalette(Math.random() * 0.5 + 0.25)
      });
    }
    this.vizState.fireflies = { items: fireflies };

    const bokeh: BokehItem[] = [];
    for (let i = 0; i < 32; i++) {
      bokeh.push({
        x: Math.random(), y: Math.random(),
        size: 0.05 + Math.random() * 0.22,
        vx: (Math.random() - 0.5) * 0.01, vy: -0.004 - Math.random() * 0.008,
        color: paletteAt(Math.random()), alpha: 0.25 + Math.random() * 0.5
      });
    }
    this.vizState.bokeh = { items: bokeh };

    const lnodes: LNode[] = [];
    for (let i = 0; i < 18; i++) {
      lnodes.push({ x: 0.08 + Math.random() * 0.84, y: 0.12 + Math.random() * 0.76 });
    }
    this.vizState.lightning = { bolts: [], nodes: lnodes, lastBeatAt: 0 };

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

  getPalette(): Palette | null { return this.trackPalette; }

  setMode(mode: VizMode) {
    this.mode = mode;
    this.autoCycle = false;
    this.emitMode();
  }
  cycleMode() {
    const i = MODE_ORDER.indexOf(this.mode);
    this.mode = MODE_ORDER[(i + 1) % MODE_ORDER.length];
    this.autoCycle = false;
    this.emitMode();
  }
  cycleModeReverse() {
    const i = MODE_ORDER.indexOf(this.mode);
    this.mode = MODE_ORDER[(i - 1 + MODE_ORDER.length) % MODE_ORDER.length];
    this.autoCycle = false;
    this.emitMode();
  }
  modeCatalog(): VizMode[] { return MODE_ORDER.slice(); }
  setAutoCycle(on: boolean) { this.autoCycle = on; }
  currentMode(): VizMode { return this.mode; }
  onModeChange(fn: (m: VizMode) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emitMode() { for (const f of this.listeners) f(this.mode); }

  resize() {
    const rect = this.bg.getBoundingClientRect();
    this.bg.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.bg.height = Math.max(1, Math.floor(rect.height * this.dpr));
  }

  start() {
    if (this.rafId !== null) return;
    const tick = () => {
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
      if (f[i] > max) { max = f[i]; pk = i; }
    }
    return pk;
  }

  private draw() {
    const now = performance.now();
    const dt = now - this.lastFrame;
    this.lastFrame = now;
    if (dt > 0) this.fpsEMA = this.fpsEMA * 0.92 + (1000 / dt) * 0.08;

    this.engine.sample();

    if (this.autoCycle && this.engine.beatPulse > 0.85) {
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
    const fft = (this.engine.analyser?.fftSize || 2048);
    this.hudFreq = (this.hudPeakBin * sr) / fft;

    switch (this.mode) {
      case 'starfield':     this.drawStarfield(ctx, w, h); break;
      case 'constellation': this.drawConstellation(ctx, w, h); break;
      case 'galaxy':        this.drawGalaxy(ctx, w, h); break;
      case 'supernova':     this.drawSupernova(ctx, w, h); break;
      case 'aurora':        this.drawAurora(ctx, w, h); break;
      case 'petals':        this.drawPetals(ctx, w, h); break;
      case 'plasma':        this.drawPlasma(ctx, w, h); break;
      case 'mandala':       this.drawMandala(ctx, w, h); break;
      case 'lightning':     this.drawLightning(ctx, w, h); break;
      case 'fireflies':     this.drawFireflies(ctx, w, h); break;
      case 'bokeh':         this.drawBokeh(ctx, w, h); break;
      case 'palette-orbs':  this.drawPaletteOrbs(ctx, w, h); break;
      case 'drop-strobe':   this.drawDropStrobe(ctx, w, h); break;
      case 'prism':         this.drawPrism(ctx, w, h); break;
      case 'synthwave':     this.drawSynthwave(ctx, w, h); break;
      case 'wormhole':      this.drawWormhole(ctx, w, h); break;
      case 'vortex':        this.drawVortex(ctx, w, h); break;
      case 'sunburst':      this.drawSunburst(ctx, w, h); break;
      case 'mirror-wave':   this.drawMirrorWave(ctx, w, h); break;
      case 'hex-grid':      this.drawHexGrid(ctx, w, h); break;
      case 'liquid':        this.drawLiquid(ctx, w, h); break;
      case 'vinyl':         this.drawVinyl(ctx, w, h); break;
      case 'matrix':        this.drawMatrix(ctx, w, h); break;
      case 'smoke':         this.drawSmoke(ctx, w, h); break;
      case 'strings':       this.drawStrings(ctx, w, h); break;
      case 'spider':        this.drawSpider(ctx, w, h); break;
      case 'cymatics':      this.drawCymatics(ctx, w, h); break;
      case 'confetti':      this.drawConfetti(ctx, w, h); break;
      case 'bloom':         this.drawBloom(ctx, w, h); break;
      case 'rose':          this.drawRose(ctx, w, h); break;
      case 'waterfall':     this.drawWaterfall(ctx, w, h); break;
      case 'gem':           this.drawGem(ctx, w, h); break;
      case 'monolith':      this.drawMonolith(ctx, w, h); break;
      case 'nebula':        this.drawNebula(ctx, w, h); break;
      case 'swarm':         this.drawSwarm(ctx, w, h); break;
      case 'ribbons':       this.drawRibbons(ctx, w, h); break;
      case 'starburst':     this.drawStarburst(ctx, w, h); break;
      case 'gravity':       this.drawGravity(ctx, w, h); break;
      case 'lattice':       this.drawLattice(ctx, w, h); break;
      case 'flux':          this.drawFlux(ctx, w, h); break;
      case 'composite':     this.drawComposite(ctx, w, h); break;
      case 'tunnel':        this.drawTunnel(ctx, w, h); break;
      case 'lissajous':     this.drawLissajous(ctx, w, h); break;
      case 'rings':         this.drawRings(ctx, w, h); break;
      case 'bars':          this.drawRadialBars(ctx, w, h); break;
      case 'wave':          this.drawOscilloscope(ctx, w, h); break;
      case 'kaleidoscope':  this.drawKaleidoscope(ctx, w, h); break;
    }
    this.drawVignette(ctx, w, h, this.engine.beatPulse);
  }

  fps() { return this.fpsEMA; }
  audioMeters() {
    return {
      bass: this.bandEnergy(0, 0.06),
      mid: this.bandEnergy(0.08, 0.32),
      treble: this.bandEnergy(0.32, 0.85),
      bpm: this.engine.bpm,
      beat: this.engine.beatPulse,
      ch: this.engine.channelEnergy(),
      peakHz: this.hudFreq,
      fft: this.engine.analyser?.fftSize || 0,
      sr: this.engine.ctx?.sampleRate || 0
    };
  }

  // ─── backgrounds ────────────────────────────────────────────────────────
  private drawGradientField(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.fillStyle = 'rgba(6,6,16,1)';
    ctx.fillRect(0, 0, w, h);
    this.drawColorBlobs(ctx, w, h);
  }

  private drawColorBlobs(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const bass = this.bandEnergy(0, 0.06);
    const mid = this.bandEnergy(0.08, 0.32);
    const treble = this.bandEnergy(0.32, 0.85);
    const energies = [bass, mid, treble, bass * 0.7 + mid * 0.3, mid * 0.5 + treble * 0.5];
    const baseR = Math.max(w, h) * (0.35 + beat * 0.1);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 5; i++) {
      const phase = t * 0.06 + i * 0.41;
      const orbit = 0.18 + (i * 0.11);
      const cx = w / 2 + Math.cos(phase * Math.PI * 2 + i) * w * orbit;
      const cy = h / 2 + Math.sin(phase * Math.PI * 2 * 0.83 + i * 1.7) * h * orbit;
      const e = energies[i];
      const r = baseR * (0.45 + e * 0.55 + beat * 0.18);
      const ck = paletteAt(t * 0.05 + i * 0.2);
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
        stars.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() * 0.99 + 0.01, px: 0, py: 0 });
      }
      this.vizState.starfield = { stars };
    }
    const stars = this.vizState.starfield.stars;
    const cx = w / 2, cy = h / 2;
    const bass = this.bandEnergy(0, 0.06);
    const beat = this.engine.beatPulse;
    const speed = 0.003 + bass * 0.018 + beat * 0.025;
    ctx.save();
    ctx.lineCap = 'round';
    for (const s of stars) {
      s.z -= speed;
      if (s.z <= 0.01) {
        s.x = Math.random() * 2 - 1;
        s.y = Math.random() * 2 - 1;
        s.z = 1;
        s.px = 0; s.py = 0;
      }
      const sx = cx + (s.x / s.z) * w * 0.55;
      const sy = cy + (s.y / s.z) * h * 0.55;
      if (sx < -50 || sx >= w + 50 || sy < -50 || sy >= h + 50) {
        s.px = sx; s.py = sy;
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
      ctx.shadowBlur = size * 4;
      ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},0.8)`;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
      s.px = sx; s.py = sy;
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
    const t = (performance.now() - this.t0) / 1000;
    const treble = this.bandEnergy(0.32, 0.85);
    const linkDist = 0.16 + treble * 0.12;
    ctx.save();

    // links
    ctx.lineWidth = this.dpr * 0.9;
    for (let i = 0; i < stars.length; i++) {
      const a = stars[i];
      for (let j = i + 1; j < stars.length; j++) {
        const b = stars[j];
        const dx = a.x - b.x, dy = a.y - b.y;
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
      const twinkle = (Math.sin(t * 2.4 + s.tw) * 0.5 + 0.5);
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
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const cx = w / 2, cy = h / 2;
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
    const t = (performance.now() - this.t0) / 1000;
    const cx = w / 2, cy = h / 2;
    const beat = this.engine.beatPulse;
    const treble = this.bandEnergy(0.32, 0.85);
    const bass = this.bandEnergy(0, 0.06);
    const dt = 1 / Math.max(30, this.fpsEMA);

    if (beat > 0.7 && (st.rings.length === 0 || st.rings[st.rings.length - 1].age > 0.06)) {
      st.rings.push({ age: 0, max: 1.6, color: paletteAt(t * 0.1) });
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const coreR = Math.min(w, h) * (0.05 + bass * 0.08);

    // corona ray spikes
    const rays = 16;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + t * 0.35;
      const len = Math.min(w, h) * (0.1 + treble * 0.32 + beat * 0.12);
      const c = paletteAt(t * 0.1 + i / rays);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.45 + treble * 0.45})`;
      ctx.lineWidth = this.dpr * (1.5 + treble * 4);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * coreR, cy + Math.sin(a) * coreR);
      ctx.lineTo(cx + Math.cos(a) * (coreR + len), cy + Math.sin(a) * (coreR + len));
      ctx.stroke();
    }

    // glowing core
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.4);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, `rgba(255,240,200,${0.7 + beat * 0.25})`);
    grad.addColorStop(0.7, 'rgba(255,160,120,0.3)');
    grad.addColorStop(1, 'rgba(255,80,140,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * 2.4, 0, Math.PI * 2);
    ctx.fill();

    // shockwave rings
    for (let i = st.rings.length - 1; i >= 0; i--) {
      const r = st.rings[i];
      r.age += dt;
      if (r.age > r.max) { st.rings.splice(i, 1); continue; }
      const k = r.age / r.max;
      const radius = k * Math.min(w, h) * 0.6;
      const alpha = (1 - k) * 0.85;
      ctx.strokeStyle = `rgba(${r.color[0]},${r.color[1]},${r.color[2]},${alpha})`;
      ctx.lineWidth = this.dpr * (1 + (1 - k) * 5);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 5. aurora — flowing draped ribbons across the sky
  private drawAurora(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const mid = this.bandEnergy(0.08, 0.32);
    const treble = this.bandEnergy(0.32, 0.85);
    const bass = this.bandEnergy(0, 0.06);
    const ribbons = 4;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const steps = 90;

    for (let r = 0; r < ribbons; r++) {
      const baseY = h * (0.16 + r * 0.18);
      const amp = h * (0.06 + mid * 0.1);
      const speed = 0.28 + r * 0.13;
      const c1 = paletteAt(t * 0.04 + r * 0.18);
      const c2 = paletteAt(t * 0.04 + r * 0.18 + 0.4);
      const ribbonH = h * (0.16 + treble * 0.14);

      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        const phase = (i / steps) * 4 + t * speed + r;
        const y = baseY
          + Math.sin(phase) * amp
          + Math.sin(phase * 2.3 + r) * amp * 0.4
          + Math.sin(phase * 0.7 + bass * 6) * amp * 0.3;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let i = steps; i >= 0; i--) {
        const x = (i / steps) * w;
        const phase = (i / steps) * 4 + t * speed + r;
        const y = baseY
          + Math.sin(phase) * amp
          + Math.sin(phase * 2.3 + r) * amp * 0.4
          + Math.sin(phase * 0.7 + bass * 6) * amp * 0.3;
        ctx.lineTo(x, y + ribbonH);
      }
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, baseY - amp, 0, baseY + ribbonH);
      grad.addColorStop(0, `rgba(${c1[0]},${c1[1]},${c1[2]},${0.55 + treble * 0.35})`);
      grad.addColorStop(0.5, `rgba(${c2[0]},${c2[1]},${c2[2]},${0.25 + mid * 0.2})`);
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
    const t = (performance.now() - this.t0) / 1000;
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
      if (y > h + 40) { st.items.splice(i, 1); continue; }
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
      off.width = 160;
      off.height = 90;
      const offCtx = off.getContext('2d', { willReadFrequently: true })!;
      const img = offCtx.createImageData(160, 90);
      this.vizState.plasma = { off, offCtx, img };
    }
    const st = this.vizState.plasma;
    const t = (performance.now() - this.t0) / 1000;
    const bass = this.bandEnergy(0, 0.06);
    const mid = this.bandEnergy(0.08, 0.32);
    const treble = this.bandEnergy(0.32, 0.85);
    const beat = this.engine.beatPulse;
    const pw = st.off.width, ph = st.off.height;
    const data = st.img.data;
    const f1 = 0.045 + bass * 0.05;
    const f2 = 0.07 + treble * 0.05;
    const f3 = 0.05 + mid * 0.04;
    const f4 = 0.04 + beat * 0.04;
    let idx = 0;
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const v = (
          Math.sin(x * f1 + t * 1.2)
          + Math.sin(y * f2 + t * 0.9)
          + Math.sin((x + y) * f3 * 0.5 + t * 0.7)
          + Math.sin(Math.sqrt((x - pw / 2) * (x - pw / 2) + (y - ph / 2) * (y - ph / 2)) * f4 + t * 1.4)
        ) / 4;
        const col = paletteAt(v * 0.5 + 0.5 + t * 0.04);
        data[idx++] = col[0];
        data[idx++] = col[1];
        data[idx++] = col[2];
        data[idx++] = 255;
      }
    }
    st.offCtx.putImageData(st.img, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.82 + beat * 0.15;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(st.off, 0, 0, w, h);
    ctx.restore();
  }

  // 10. mandala — concentric rings of petals with 12-fold symmetry
  private drawMandala(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const cx = w / 2, cy = h / 2;
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

  // 11. lightning — jagged bolts arc between nodes on every beat
  private genBoltPoints(x0: number, y0: number, x1: number, y1: number, generations: number, disp: number): Array<[number, number]> {
    let pts: Array<[number, number]> = [[x0, y0], [x1, y1]];
    for (let g = 0; g < generations; g++) {
      const next: Array<[number, number]> = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        next.push([ax, ay]);
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        const dx = bx - ax, dy = by - ay;
        const nx = -dy, ny = dx;
        const len = Math.sqrt(nx * nx + ny * ny) || 1;
        const k = (Math.random() - 0.5) * disp * Math.pow(0.55, g);
        next.push([mx + (nx / len) * k, my + (ny / len) * k]);
      }
      next.push(pts[pts.length - 1]);
      pts = next;
    }
    return pts;
  }

  private drawLightning(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (!this.vizState.lightning) {
      const nodes: LNode[] = [];
      for (let i = 0; i < 18; i++) {
        nodes.push({ x: 0.08 + Math.random() * 0.84, y: 0.12 + Math.random() * 0.76 });
      }
      this.vizState.lightning = { bolts: [], nodes, lastBeatAt: 0 };
    }
    const st = this.vizState.lightning;
    const now = performance.now();
    const t = (now - this.t0) / 1000;
    const dt = 1 / Math.max(30, this.fpsEMA);
    const beat = this.engine.beatPulse;

    if (beat > 0.7 && now - st.lastBeatAt > 90) {
      const count = 1 + Math.floor(beat * 3);
      for (let k = 0; k < count; k++) {
        const a = st.nodes[Math.floor(Math.random() * st.nodes.length)];
        const b = st.nodes[Math.floor(Math.random() * st.nodes.length)];
        if (a === b) continue;
        const ax = a.x * w, ay = a.y * h, bx = b.x * w, by = b.y * h;
        const disp = Math.hypot(bx - ax, by - ay) * 0.18;
        st.bolts.push({
          points: this.genBoltPoints(ax, ay, bx, by, 5, disp),
          age: 0, ttl: 0.32 + Math.random() * 0.18,
          col: paletteAt(t * 0.1 + Math.random() * 0.3)
        });
      }
      st.lastBeatAt = now;
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    // nodes
    for (const n of st.nodes) {
      const col = paletteAt(t * 0.08 + n.x);
      ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.35 + beat * 0.45})`;
      ctx.shadowBlur = 16 * this.dpr;
      ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},0.8)`;
      ctx.beginPath();
      ctx.arc(n.x * w, n.y * h, this.dpr * (2.4 + beat * 2.5), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    // bolts (cached points, no flicker)
    for (let i = st.bolts.length - 1; i >= 0; i--) {
      const b = st.bolts[i];
      b.age += dt;
      if (b.age > b.ttl) { st.bolts.splice(i, 1); continue; }
      const k = b.age / b.ttl;
      const alpha = 1 - k;
      const col = b.col;
      // halo
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha * 0.45})`;
      ctx.lineWidth = this.dpr * 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let p = 0; p < b.points.length; p++) {
        const [px, py] = b.points[p];
        if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      // core
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = this.dpr * 1.5;
      ctx.beginPath();
      for (let p = 0; p < b.points.length; p++) {
        const [px, py] = b.points[p];
        if (p === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  // 12. fireflies meadow — slow wandering glow particles with own pulse rates
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
    const t = (performance.now() - this.t0) / 1000;
    const items = this.vizState.fireflies.items;
    const beat = this.engine.beatPulse;
    const treble = this.bandEnergy(0.32, 0.85);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const f of items) {
      const x = (f.x + Math.sin(t * 0.18 + f.ax) * 0.12) * w;
      const y = (f.y + Math.cos(t * 0.14 + f.ay) * 0.12) * h;
      const pulse = (Math.sin(t * f.rate + f.phase) * 0.5 + 0.5);
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
      if (b.y < -0.3) { b.y = 1.2; b.x = Math.random(); }
      if (b.x < -0.3) b.x = 1.2; else if (b.x > 1.3) b.x = -0.2;
      const cx = b.x * w, cy = b.y * h;
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
    const t = (performance.now() - this.t0) / 1000;
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
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
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
    const t = (performance.now() - this.t0) / 1000;
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
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
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
    const t = (performance.now() - this.t0) / 1000;
    const rings = 64;
    const radMax = Math.min(w, h) * 0.46;
    const beat = this.engine.beatPulse;

    for (let r = 0; r < rings; r++) {
      const idx = Math.floor((r / rings) * f.length * 0.55);
      const v = (f[idx] || 0) / 255;
      const ck = paletteAt(t * 0.04 + r / rings);
      const rad = (r / rings) * radMax * (1 + v * 0.18 + beat * 0.04);
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      if (r % 4 === 0 && v > 0.18) {
        ctx.fillStyle = `rgba(${ck[0]},${ck[1]},${ck[2]},${0.05 + v * 0.18})`;
        ctx.fill();
      }
      ctx.strokeStyle = `rgba(${ck[0]},${ck[1]},${ck[2]},${0.08 + v * 0.78})`;
      ctx.lineWidth = this.dpr * (0.6 + v * 3.2);
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
    const bars = 96;
    const step = Math.max(1, Math.floor(f.length / bars));
    const radInner = Math.min(w, h) * 0.15;
    const radOuter = Math.min(w, h) * 0.4;
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.06);
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      for (let k = 0; k < step; k++) sum += f[i * step + k] || 0;
      const v = sum / step / 255;
      const a = (i / bars) * Math.PI * 2;
      const len = radInner + v * (radOuter - radInner) * (1 + beat * 0.4);
      const ck = paletteAt(t * 0.07 + i / bars);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * radInner, Math.sin(a) * radInner);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.strokeStyle = `rgba(${ck[0]},${ck[1]},${ck[2]},${0.4 + v * 0.6})`;
      ctx.lineWidth = this.dpr * 2.2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawOscilloscope(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const tL = this.engine.timeData;
    if (!tL.length) return;
    const cy = h / 2;
    const t = (performance.now() - this.t0) / 1000;
    const accent = this.accent;
    ctx.save();
    ctx.lineWidth = this.dpr * 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let layer = 0; layer < 3; layer++) {
      const ck = paletteAt(t * 0.05 + layer * 0.2);
      const off = (layer - 1) * h * 0.04;
      ctx.beginPath();
      for (let i = 0; i < tL.length; i++) {
        const x = (i / tL.length) * w;
        const v = (tL[i] - 128) / 128;
        const y = cy + off + v * h * (0.18 + this.engine.beatPulse * 0.08);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = layer === 1
        ? `rgba(${accent[0]},${accent[1]},${accent[2]},0.95)`
        : `rgba(${ck[0]},${ck[1]},${ck[2]},0.55)`;
      ctx.shadowBlur = layer === 1 ? 18 * this.dpr : 0;
      ctx.shadowColor = `rgba(${accent[0]},${accent[1]},${accent[2]},0.8)`;
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
    const t = (performance.now() - this.t0) / 1000;
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
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const palette = this.trackPalette;
    const swatches: Array<[number, number, number]> = palette
      ? [palette.vibrant, palette.complementary, palette.lightMuted, palette.muted, palette.darkVibrant]
      : PALETTE_KEYFRAMES;
    const bands = [
      this.bandEnergy(0, 0.04),
      this.bandEnergy(0.05, 0.12),
      this.bandEnergy(0.14, 0.28),
      this.bandEnergy(0.30, 0.52),
      this.bandEnergy(0.55, 0.85)
    ];
    const cx = w / 2, cy = h / 2;
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
    const t = (performance.now() - this.t0) / 1000;
    const engine = this.engine;
    if (engine.dropImminent) this.strobePulse = 1;
    this.strobePulse = Math.max(0, this.strobePulse - 0.018);
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
      ctx.fillRect(x - w / cols / 3, 0, w / cols * 0.66, h);
    }
    ctx.restore();

    // The strobe itself — accent overlay, falls off across ~55 frames.
    if (this.strobePulse > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(${vibrant[0]},${vibrant[1]},${vibrant[2]},${this.strobePulse * 0.45})`;
      ctx.fillRect(0, 0, w, h);
      // Radial shockwave from centre.
      const cx = w / 2, cy = h / 2;
      const rad = Math.max(w, h) * (1 - this.strobePulse) * 1.4;
      const wave = ctx.createRadialGradient(cx, cy, rad * 0.85, cx, cy, rad);
      wave.addColorStop(0, 'rgba(255,255,255,0)');
      wave.addColorStop(0.5, `rgba(${complement[0]},${complement[1]},${complement[2]},${this.strobePulse * 0.55})`);
      wave.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = wave;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // ─── prism ─── radial bars with chromatic-aberration R/G/B split.
  // CA offset scales with treble. Pulls colors from per-track palette.
  private drawPrism(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const treble = this.bandEnergy(0.40, 0.85);
    const palette = this.trackPalette;
    const aColor = palette ? palette.vibrant : this.accent;
    const bColor = palette ? palette.complementary : [255, 80, 200];
    const cx = w / 2, cy = h / 2;
    const f = this.engine.freqData;
    const bars = 96;
    const step = Math.max(1, Math.floor(f.length * 0.6 / bars));
    const offset = (this.dpr * 2) + treble * (this.dpr * 14) + beat * (this.dpr * 6);

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
        pass === 0 ? [aColor[0], 28, 28] :
        pass === 1 ? [Math.round((aColor[1] + bColor[1]) / 2), Math.round((aColor[1] + bColor[1]) / 2), 28] :
        [28, 28, bColor[2]];
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
      const swatches = [palette.vibrant, palette.complementary, palette.lightMuted, palette.darkVibrant, palette.muted];
      ctx.lineWidth = this.dpr * (1.5 + beat * 2);
      for (let s = 0; s < swatches.length; s++) {
        const c = swatches[s];
        ctx.beginPath();
        const start = (s / swatches.length) * Math.PI * 2;
        const end = ((s + 0.85) / swatches.length) * Math.PI * 2;
        const r = Math.min(w, h) * 0.10;
        ctx.arc(0, 0, r, start, end);
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.75 + beat * 0.2})`;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ─── catalog expansion (26 modes) ──────────────────────────────────────
  // All palette-aware via paletteAt() / this.trackPalette. Lightweight 2D.

  private drawSynthwave(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const bass = this.bandEnergy(0, 0.08);
    const horizon = h * 0.55;
    const p = this.trackPalette;
    const vib = p?.vibrant ?? paletteAt(0);
    const comp = p?.complementary ?? paletteAt(0.4);
    // sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, `rgba(${comp[0]},${comp[1]},${comp[2]},0.22)`);
    sky.addColorStop(1, `rgba(${vib[0]},${vib[1]},${vib[2]},0.08)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);
    // sun
    const sunR = Math.min(w, h) * (0.12 + beat * 0.04);
    const sg = ctx.createRadialGradient(w / 2, horizon * 0.9, sunR * 0.2, w / 2, horizon * 0.9, sunR);
    sg.addColorStop(0, `rgba(${vib[0]},${vib[1]},${vib[2]},1)`);
    sg.addColorStop(1, `rgba(${vib[0]},${vib[1]},${vib[2]},0)`);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(w / 2, horizon * 0.9, sunR, 0, Math.PI * 2);
    ctx.fill();
    // sun stripes
    for (let i = 0; i < 6; i++) {
      const y = horizon * 0.65 + i * sunR * 0.18 + t * 4;
      ctx.fillStyle = `rgba(2,2,8,0.7)`;
      ctx.fillRect(w / 2 - sunR, y, sunR * 2, sunR * 0.06);
    }
    // perspective grid
    ctx.strokeStyle = `rgba(${vib[0]},${vib[1]},${vib[2]},${0.55 + bass * 0.35})`;
    ctx.lineWidth = this.dpr * 1.4;
    // horizontal lines marching toward camera
    const rows = 14;
    for (let i = 0; i < rows; i++) {
      const f = ((i + (t * (0.5 + bass * 1.5))) % rows) / rows;
      const yLine = horizon + Math.pow(f, 2.6) * (h - horizon);
      ctx.globalAlpha = 0.15 + f * 0.75;
      ctx.beginPath();
      ctx.moveTo(0, yLine);
      ctx.lineTo(w, yLine);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // vanishing point verticals
    const vx = w / 2;
    for (let i = -10; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(vx + (i / 10) * w * 0.05, horizon);
      ctx.lineTo(vx + (i / 10) * w * 2.5, h);
      ctx.globalAlpha = 0.45;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawWormhole(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const bass = this.bandEnergy(0, 0.08);
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.hypot(w, h) * 0.55;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.06);
    const rings = 28;
    for (let i = 0; i < rings; i++) {
      const f = ((i + (t * (0.6 + bass * 1.4))) % rings) / rings;
      const r = Math.pow(1 - f, 2.2) * maxR;
      const c = paletteAt(f + t * 0.04);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.15 + (1 - f) * 0.7})`;
      ctx.lineWidth = this.dpr * (1.4 + (1 - f) * 6 + beat * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawVortex(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = 'lighter';
    const arms = 5;
    const perArm = 220;
    for (let a = 0; a < arms; a++) {
      const base = (a / arms) * Math.PI * 2;
      for (let i = 0; i < perArm; i++) {
        const u = i / perArm;
        const r = u * maxR;
        const swirl = base + u * (4 + beat * 2) + t * 0.6;
        const x = Math.cos(swirl) * r;
        const y = Math.sin(swirl) * r;
        const c = paletteAt(u + a * 0.18);
        const size = this.dpr * (1.2 + (1 - u) * 2.2);
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.25 + (1 - u) * 0.6})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawSunburst(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const f = this.engine.freqData;
    const cx = w / 2;
    const cy = h / 2;
    const rays = 96;
    const innerR = Math.min(w, h) * (0.10 + beat * 0.04);
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
    const amp = Math.min(w, h) * 0.30;
    ctx.lineWidth = this.dpr * 2.2;
    ctx.lineCap = 'round';
    // horizontal pair (top + bottom mirror)
    for (let pass = 0; pass < 2; pass++) {
      const dir = pass === 0 ? -1 : 1;
      ctx.beginPath();
      for (let i = 0; i < t.length; i++) {
        const u = i / (t.length - 1);
        const x = u * w;
        const y = cy + dir * ((t[i] - 128) / 128) * amp;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      const c = pass === 0 ? accent : comp;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.85)`;
      ctx.stroke();
    }
    // vertical pair (left + right mirror)
    for (let pass = 0; pass < 2; pass++) {
      const dir = pass === 0 ? -1 : 1;
      ctx.beginPath();
      for (let i = 0; i < t.length; i++) {
        const u = i / (t.length - 1);
        const y = u * h;
        const x = cx + dir * ((t[i] - 128) / 128) * amp;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      const c = paletteAt(0.7 + pass * 0.15);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.55)`;
      ctx.stroke();
    }
  }

  private drawHexGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const f = this.engine.freqData;
    const cell = Math.max(28, Math.min(w, h) / 22);
    const dx = cell * Math.sqrt(3);
    const dy = cell * 1.5;
    let bin = 0;
    for (let row = -1; row * dy < h + cell; row++) {
      const offx = (row & 1) ? dx / 2 : 0;
      for (let col = -1; col * dx + offx < w + cell; col++) {
        const x = col * dx + offx;
        const y = row * dy;
        const b = Math.floor((bin * 7919) % f.length * 0.7);
        const v = (f[b] || 0) / 255;
        bin++;
        if (v < 0.05) continue;
        const c = paletteAt((bin % 100) / 100);
        ctx.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const px = x + Math.cos(a) * cell * 0.55;
          const py = y + Math.sin(a) * cell * 0.55;
          if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.15 + v * 0.75})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.3 + v * 0.5})`;
        ctx.lineWidth = this.dpr;
        ctx.stroke();
      }
    }
  }

  private drawLiquid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
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
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 1.2);
    // body
    ctx.fillStyle = 'rgba(8,8,14,0.95)';
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    // grooves driven by freqData
    const f = this.engine.freqData;
    const grooves = 60;
    for (let i = 0; i < grooves; i++) {
      const u = i / grooves;
      const r = R * (0.35 + u * 0.6);
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

  private drawMatrix(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const beat = this.engine.beatPulse;
    const treble = this.bandEnergy(0.32, 0.85);
    const cell = Math.max(14, Math.min(w, h) / 56);
    const cols = Math.ceil(w / cell);
    const st = (this.vizState as { matrix?: { col: number[]; speed: number[] } });
    if (!st.matrix || st.matrix.col.length !== cols) {
      st.matrix = {
        col: Array.from({ length: cols }, () => Math.random() * h),
        speed: Array.from({ length: cols }, () => cell * (0.4 + Math.random() * 1.2))
      };
    }
    ctx.fillStyle = 'rgba(2,2,8,0.18)';
    ctx.fillRect(0, 0, w, h);
    const glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789';
    ctx.font = `${cell * 1.05}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const c = this.trackPalette?.vibrant ?? [120, 255, 160];
    for (let i = 0; i < cols; i++) {
      const y = st.matrix.col[i];
      const s = st.matrix.speed[i] * (0.85 + treble * 1.4);
      st.matrix.col[i] = (y + s) % (h + cell * 18);
      // head
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.95})`;
      const g0 = glyphs[Math.floor(Math.random() * glyphs.length)];
      ctx.fillText(g0, i * cell + cell / 2, y);
      // trail
      for (let k = 1; k < 16; k++) {
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(1 - k / 16) * 0.6})`;
        const g = glyphs[Math.floor(Math.random() * glyphs.length)];
        ctx.fillText(g, i * cell + cell / 2, y - k * cell);
      }
    }
    if (beat > 0.85) ctx.globalAlpha = 1;
  }

  private drawSmoke(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const bass = this.bandEnergy(0, 0.08);
    const st = (this.vizState as { smoke?: { items: { x: number; y: number; vx: number; vy: number; r: number; life: number; c: [number, number, number] }[] } });
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
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      p.x += p.vx + Math.sin(t + i) * 0.2;
      p.y += p.vy;
      p.r += 0.4;
      p.life -= 0.012;
      if (p.life <= 0 || p.y < -p.r) { items.splice(i, 1); continue; }
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
    const t = (performance.now() - this.t0) / 1000;
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
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
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
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      const cc = paletteAt(u);
      ctx.strokeStyle = `rgba(${cc[0]},${cc[1]},${cc[2]},${0.4 + u * 0.4})`;
      ctx.lineWidth = this.dpr * (1 + u * 1.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawCymatics(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
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
    const st = (this.vizState as { confetti?: { items: { x: number; y: number; vx: number; vy: number; rot: number; vr: number; sz: number; c: [number, number, number]; life: number }[] } });
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
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      p.vy += 0.3;
      p.vx *= 0.992;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= 0.008;
      if (p.life <= 0 || p.y > h + 40) { items.splice(i, 1); continue; }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${p.life})`;
      ctx.fillRect(-p.sz / 2, -p.sz / 4, p.sz, p.sz / 2);
      ctx.restore();
    }
  }

  private drawBloom(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const orbs = 9;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < orbs; i++) {
      const ph = i * 0.83 + t * (0.35 + i * 0.05);
      const x = w / 2 + Math.cos(ph) * w * 0.36;
      const y = h / 2 + Math.sin(ph * 1.13) * h * 0.32;
      const r = Math.min(w, h) * (0.10 + 0.04 * (i % 3) + beat * 0.05);
      const c = paletteAt(i / orbs);
      for (let pass = 0; pass < 3; pass++) {
        const k = (pass + 1);
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
    const t = (performance.now() - this.t0) / 1000;
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
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
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
    const st = (this.vizState as { waterfall?: { off: HTMLCanvasElement; ctx: CanvasRenderingContext2D; row: number } });
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
    for (let i = 0; i < cols; i++) {
      const x = (i / cols) * w;
      const v = f[Math.floor((i / cols) * f.length * 0.7)] / 255;
      const c = paletteAt(v * 0.6 + 0.1);
      const a = Math.pow(v, 0.7);
      off.ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      off.ctx.fillRect(x, y, Math.max(1, w / cols + 1), rowH);
    }
    ctx.drawImage(off.off, 0, 0);
  }

  private drawGem(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const bass = this.bandEnergy(0, 0.08);
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * (0.30 + bass * 0.05);
    const sides = 8;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.25);
    // facets
    for (let s = 0; s < sides; s++) {
      const a0 = (s / sides) * Math.PI * 2;
      const a1 = ((s + 1) / sides) * Math.PI * 2;
      const c = paletteAt(s / sides + t * 0.05);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
      ctx.lineTo(Math.cos(a1) * R, Math.sin(a1) * R);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, Math.cos((a0 + a1) / 2) * R, Math.sin((a0 + a1) / 2) * R);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.85})`);
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},${0.25})`);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.15 + beat * 0.25})`;
      ctx.lineWidth = this.dpr;
      ctx.stroke();
    }
    // highlight
    const hc = paletteAt(0.1);
    const hg = ctx.createRadialGradient(-R * 0.3, -R * 0.3, 0, -R * 0.3, -R * 0.3, R * 0.7);
    hg.addColorStop(0, `rgba(255,255,255,${0.3 + beat * 0.4})`);
    hg.addColorStop(1, `rgba(${hc[0]},${hc[1]},${hc[2]},0)`);
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawMonolith(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const f = this.engine.freqData;
    const bars = 40;
    const step = Math.floor(f.length * 0.7 / bars);
    const bw = w / bars;
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
      grad.addColorStop(1, `rgba(${Math.round(c[0] * 0.3)},${Math.round(c[1] * 0.3)},${Math.round(c[2] * 0.3)},0.85)`);
      ctx.fillStyle = grad;
      ctx.fillRect(x + bw * 0.08, y, bw * 0.84, bh);
      // windows
      const winRows = Math.floor(bh / (bw * 0.45));
      for (let r = 0; r < winRows; r++) {
        for (let cI = 0; cI < 3; cI++) {
          const wx = x + bw * 0.18 + cI * bw * 0.25;
          const wy = y + r * bw * 0.45 + bw * 0.1;
          const lit = ((i * 31 + r * 17 + cI * 7) % 5) < 2;
          ctx.fillStyle = lit ? `rgba(255,240,180,${0.45 + v * 0.4})` : 'rgba(40,40,60,0.5)';
          ctx.fillRect(wx, wy, bw * 0.16, bw * 0.22);
        }
      }
    }
  }

  private drawNebula(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const mid = this.bandEnergy(0.08, 0.32);
    const blobs = 14;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < blobs; i++) {
      const ph = i * 1.7 + t * (0.06 + i * 0.01);
      const cx = w / 2 + Math.cos(ph) * w * 0.4;
      const cy = h / 2 + Math.sin(ph * 1.3) * h * 0.4;
      const r = Math.min(w, h) * (0.18 + 0.04 * (i % 3) + mid * 0.05);
      const c = paletteAt(i / blobs + t * 0.02);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.35)`);
      grad.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},0.12)`);
      grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // glittering dust
    for (let i = 0; i < 60; i++) {
      const x = (Math.sin(i * 9.31 + t) * 0.5 + 0.5) * w;
      const y = (Math.cos(i * 7.13 + t * 0.6) * 0.5 + 0.5) * h;
      const c = starPalette((i / 60));
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.5 + Math.sin(t * 4 + i) * 0.4})`;
      ctx.beginPath();
      ctx.arc(x, y, this.dpr * 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawSwarm(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const treble = this.bandEnergy(0.32, 0.85);
    const st = (this.vizState as { swarm?: { items: { x: number; y: number; vx: number; vy: number }[] } });
    if (!st.swarm) {
      st.swarm = {
        items: Array.from({ length: 140 }, () => ({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2
        }))
      };
    }
    const items = st.swarm.items;
    // attractor moves
    const ax = w / 2 + Math.cos(t * 0.6) * w * 0.3;
    const ay = h / 2 + Math.sin(t * 0.4) * h * 0.3;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      const dx = ax - p.x;
      const dy = ay - p.y;
      const d = Math.hypot(dx, dy) + 0.01;
      p.vx += (dx / d) * (0.3 + beat * 0.6);
      p.vy += (dy / d) * (0.3 + beat * 0.6);
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x += w; else if (p.x > w) p.x -= w;
      if (p.y < 0) p.y += h; else if (p.y > h) p.y -= h;
      const c = paletteAt((i / items.length + t * 0.05) % 1);
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.6 + treble * 0.3})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.dpr * (1.3 + beat * 1.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawRibbons(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
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
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.55 + v * 0.4})`;
      ctx.lineWidth = this.dpr * (3 + r * 1.1 + v * 4);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawStarburst(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const drop = this.engine.dropImminent;
    const st = (this.vizState as { starburst?: { items: { x: number; y: number; vx: number; vy: number; life: number; c: [number, number, number] }[] } });
    if (!st.starburst) st.starburst = { items: [] };
    const items = st.starburst.items;
    if (beat > 0.7 || drop) {
      const n = 40;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
        const sp = 10 + Math.random() * 16;
        items.push({
          x: w / 2,
          y: h / 2,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          c: paletteAt(i / n + t * 0.1)
        });
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = items.length - 1; i >= 0; i--) {
      const p = items[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= 0.016;
      if (p.life <= 0) { items.splice(i, 1); continue; }
      const tail = 12;
      const grad = ctx.createLinearGradient(p.x, p.y, p.x - p.vx * tail, p.y - p.vy * tail);
      grad.addColorStop(0, `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${p.life})`);
      grad.addColorStop(1, `rgba(${p.c[0]},${p.c[1]},${p.c[2]},0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = this.dpr * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * tail, p.y - p.vy * tail);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawGravity(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const t = (performance.now() - this.t0) / 1000;
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
    const t = (performance.now() - this.t0) / 1000;
    const beat = this.engine.beatPulse;
    const bass = this.bandEnergy(0, 0.08);
    const cx = w / 2;
    const cy = h / 2;
    const size = Math.min(w, h) * 0.32;
    // 8 cube vertices
    const verts: [number, number, number][] = [];
    for (let i = 0; i < 8; i++) {
      verts.push([
        ((i & 1) ? 1 : -1),
        ((i & 2) ? 1 : -1),
        ((i & 4) ? 1 : -1)
      ]);
    }
    const edges: [number, number][] = [
      [0, 1], [0, 2], [0, 4], [1, 3], [1, 5],
      [2, 3], [2, 6], [3, 7], [4, 5], [4, 6],
      [5, 7], [6, 7]
    ];
    const ax = t * 0.6;
    const ay = t * 0.4;
    const az = t * 0.3;
    const ca = Math.cos(ax), sa = Math.sin(ax);
    const cb = Math.cos(ay), sb = Math.sin(ay);
    const cc = Math.cos(az), sc2 = Math.sin(az);
    const project = (v: [number, number, number]): [number, number, number] => {
      let [x, y, z] = v;
      // rot x
      let y2 = y * ca - z * sa;
      let z2 = y * sa + z * ca;
      y = y2; z = z2;
      // rot y
      let x2 = x * cb + z * sb;
      z2 = -x * sb + z * cb;
      x = x2; z = z2;
      // rot z
      x2 = x * cc - y * sc2;
      y2 = x * sc2 + y * cc;
      x = x2; y = y2;
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
    const t = (performance.now() - this.t0) / 1000;
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
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${0.4 + beat * 0.3})`;
      ctx.lineWidth = this.dpr * 1.3;
      ctx.stroke();
    }
    // poles
    for (const p of poles) {
      const c = p.sign > 0 ? (this.trackPalette?.vibrant ?? paletteAt(0)) : (this.trackPalette?.complementary ?? paletteAt(0.5));
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
