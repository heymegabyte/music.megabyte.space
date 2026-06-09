import type { Track } from './types';

type Listener = () => void;

export interface EQSettings {
  bass: number;
  mid: number;
  treble: number;
}

export type ReverbPreset = 'dry' | 'room' | 'hall' | 'cathedral' | 'spring' | 'plate';

const REVERB_PRESETS: Record<ReverbPreset, { duration: number; decay: number; reverse: boolean; wet: number }> = {
  dry:       { duration: 0.4, decay: 4.0, reverse: false, wet: 0.0 },
  room:      { duration: 1.2, decay: 3.0, reverse: false, wet: 0.12 },
  hall:      { duration: 2.6, decay: 2.4, reverse: false, wet: 0.22 },
  cathedral: { duration: 4.8, decay: 1.8, reverse: false, wet: 0.32 },
  spring:    { duration: 1.6, decay: 5.0, reverse: false, wet: 0.18 },
  plate:     { duration: 2.0, decay: 3.5, reverse: true,  wet: 0.20 }
};

export class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  splitter: ChannelSplitterNode | null = null;
  analyserL: AnalyserNode | null = null;
  analyserR: AnalyserNode | null = null;
  gain: GainNode | null = null;
  source: MediaElementAudioSourceNode | null = null;
  highpass: BiquadFilterNode | null = null;
  bass: BiquadFilterNode | null = null;
  mid: BiquadFilterNode | null = null;
  treble: BiquadFilterNode | null = null;
  compressor: DynamicsCompressorNode | null = null;
  convolver: ConvolverNode | null = null;
  wetGain: GainNode | null = null;
  dryGain: GainNode | null = null;
  audio: HTMLAudioElement;
  freqData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  timeData: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  freqL: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  freqR: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(0));
  current: Track | null = null;
  beatPulse = 0;
  lastBeatAt = 0;
  bpm = 0;
  // Drop predictor — RMS flux derivative over a 4s window flags impending
  // drops ~150ms early so visualizers can choreograph the climax.
  rms = 0;
  rmsFluxSlope = 0;
  dropImminent = false;
  dropPredictedAt = 0;
  dropEnergy = 0;          // 0-1 smoothed RMS — drives strobe brightness
  buildPhase = 0;          // 0 = silence/release · 1 = peak build-up
  private rmsHistory: number[] = [];
  private dropCooldownUntil = 0;
  private energyHistory: number[] = [];
  private listeners = new Set<Listener>();
  private unlocked = false;
  // Low-power surfaces (mobile / few cores / reduced-data) get a leaner Web
  // Audio graph: NO always-on convolver (the single most CPU-expensive node —
  // it ran at 0.08 wet, near-inaudible, every frame), smaller FFTs, and no
  // stereo-split analysers. The convolver is built lazily the first time a
  // wet reverb preset is actually selected. Verified bottleneck on Pixel 8 /
  // Chrome mobile (2026-06).
  lowPower = false;
  private mergerNode: GainNode | null = null;
  /** Outstanding `audio.play()` promise. We `await` it before mutating `src`
   *  so back-to-back track switches don't trigger AbortError races. */
  private playPromise: Promise<void> | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'metadata';
    this.audio.volume = 0.85;
    // Suppress Chrome's built-in Remote Playback picker — we route casting
    // through the Cast SDK's CastContext.requestSession() instead, so the
    // browser shouldn't auto-prompt the system Remote Playback overlay.
    this.audio.disableRemotePlayback = true;
    // Allow Safari/iOS AirPlay route — `x-webkit-airplay="allow"` opts in
    // even when `disableRemotePlayback` is set above (the WebKit attribute
    // pre-dates the standard property and is treated independently). The
    // AirPlay button surfaces via `airplayAvailable()` in src/web-share.ts
    // once Safari signals an available route.
    this.audio.setAttribute('x-webkit-airplay', 'allow');
    this.audio.setAttribute('data-engine', 'bz');
    this.audio.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
    if (typeof document !== 'undefined' && document.body) document.body.appendChild(this.audio);
    else if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => document.body.appendChild(this.audio), { once: true });
    this.audio.addEventListener('ended', () => this.emit());
    this.audio.addEventListener('play', () => this.emit());
    this.audio.addEventListener('pause', () => this.emit());
    this.audio.addEventListener('timeupdate', () => this.emit());
    this.audio.addEventListener('loadedmetadata', () => this.emit());
    // Self-heal transient origin faults (e.g. Cloudflare ASSETS cold-start 503
    // under preload burst). The <audio> element has no built-in recovery — a
    // single blip otherwise strands playback. Reload the same src ONCE per track
    // after a short backoff, restoring position + play state.
    this.audio.addEventListener('error', () => {
      const code = this.audio.error?.code;
      if (!this.current || (code !== 2 && code !== 4)) return; // network/src only
      if (this.reloadGuard === this.current.id) return;        // already retried this track
      this.reloadGuard = this.current.id;
      const wasPlaying = !this.audio.paused;
      const at = this.audio.currentTime || 0;
      setTimeout(() => {
        if (!this.audio.src) return;
        this.audio.load();
        if (wasPlaying) this.audio.play().then(() => { if (at) this.audio.currentTime = at; }).catch(() => { /* gesture/abort */ });
      }, 700);
    });
  }

  private reloadGuard = '';

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  /** Detect a low-power surface — mobile viewport + coarse pointer, ≤4 cores,
   *  low device-memory, or reduced-data. Cached on first call. Drives the lean
   *  Web Audio graph below. */
  private detectLowPower(): boolean {
    if (typeof window === 'undefined' || typeof matchMedia !== 'function') return false;
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const coarseSmall = matchMedia('(max-width: 768px) and (pointer: coarse)').matches;
    const fewCores = (nav.hardwareConcurrency ?? 8) <= 4;
    const lowMem = (nav.deviceMemory ?? 8) <= 4;
    const saveData = nav.connection?.saveData === true;
    const reducedData = matchMedia('(prefers-reduced-data: reduce)').matches;
    return coarseSmall || fewCores || lowMem || saveData || reducedData;
  }

  /** Deferred AudioContext init — must be triggered by a user gesture to satisfy browser autoplay policy. */
  unlock() {
    if (this.unlocked) return;
    const W = window as unknown as { webkitAudioContext?: typeof AudioContext };
    const Ctx = window.AudioContext || W.webkitAudioContext;
    if (!Ctx) return;
    this.lowPower = this.detectLowPower();
    const ctx = new Ctx();
    this.ctx = ctx;

    this.source = ctx.createMediaElementSource(this.audio);

    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 30;
    this.highpass.Q.value = 0.7;

    this.bass = ctx.createBiquadFilter();
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 180;
    this.bass.gain.value = 3;

    this.mid = ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 1200;
    this.mid.Q.value = 0.9;
    this.mid.gain.value = 1;

    this.treble = ctx.createBiquadFilter();
    this.treble.type = 'highshelf';
    this.treble.frequency.value = 6500;
    this.treble.gain.value = 2;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.22;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = this.lowPower ? 1.0 : 0.92;
    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = this.lowPower ? 0 : 0.08;

    this.gain = ctx.createGain();
    this.gain.gain.value = 0.95;

    this.analyser = ctx.createAnalyser();
    // Smaller FFT on low-power: 1024 bins is plenty for the bar/wave viz and
    // halves the per-frame analysis cost vs 2048.
    this.analyser.fftSize = this.lowPower ? 1024 : 2048;
    this.analyser.smoothingTimeConstant = 0.84;
    this.freqData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.timeData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

    const merger = ctx.createGain();
    this.mergerNode = merger;

    // input → highpass → bass → mid → treble → compressor → dry → merger
    this.source.connect(this.highpass);
    this.highpass.connect(this.bass);
    this.bass.connect(this.mid);
    this.mid.connect(this.treble);
    this.treble.connect(this.compressor);
    this.compressor.connect(this.dryGain);
    this.dryGain.connect(merger);

    if (!this.lowPower) {
      // Full graph: always-on convolver reverb + stereo-split analysers.
      this.convolver = ctx.createConvolver();
      this.convolver.normalize = true;
      this.convolver.buffer = makeImpulseResponse(ctx, 2.6, 2.6, false);
      this.compressor.connect(this.convolver);
      this.convolver.connect(this.wetGain);
      this.wetGain.connect(merger);

      this.splitter = ctx.createChannelSplitter(2);
      this.analyserL = ctx.createAnalyser();
      this.analyserR = ctx.createAnalyser();
      this.analyserL.fftSize = 1024;
      this.analyserR.fftSize = 1024;
      this.analyserL.smoothingTimeConstant = 0.7;
      this.analyserR.smoothingTimeConstant = 0.7;
      this.freqL = new Uint8Array(new ArrayBuffer(this.analyserL.frequencyBinCount));
      this.freqR = new Uint8Array(new ArrayBuffer(this.analyserR.frequencyBinCount));
      merger.connect(this.splitter);
      this.splitter.connect(this.analyserL, 0);
      this.splitter.connect(this.analyserR, 1);
    }
    // Low-power: NO convolver (built lazily in ensureConvolver() if the user
    // picks a wet preset), NO stereo split. channelEnergy() falls back to the
    // mono analyser so the visualizer's stereo-skew degrades gracefully.

    merger.connect(this.analyser);
    this.analyser.connect(this.gain);
    this.gain.connect(ctx.destination);

    this.unlocked = true;
  }

  /** Lazily build the convolver + stereo analysers the first time reverb is
   *  genuinely needed on a low-power device (user picks room/hall/etc). Keeps
   *  the default mobile graph lean while still honoring an explicit choice. */
  private ensureConvolver(): boolean {
    if (this.convolver) return true;
    const ctx = this.ctx;
    if (!ctx || !this.compressor || !this.mergerNode) return false;
    this.convolver = ctx.createConvolver();
    this.convolver.normalize = true;
    this.convolver.buffer = makeImpulseResponse(ctx, 2.6, 2.6, false);
    this.compressor.connect(this.convolver);
    this.convolver.connect(this.wetGain!);
    this.wetGain!.connect(this.mergerNode);
    return true;
  }

  setEQ(eq: Partial<EQSettings>) {
    if (eq.bass !== undefined && this.bass) this.bass.gain.value = eq.bass;
    if (eq.mid !== undefined && this.mid) this.mid.gain.value = eq.mid;
    if (eq.treble !== undefined && this.treble) this.treble.gain.value = eq.treble;
  }

  setReverbWet(amount: number) {
    const v = Math.max(0, Math.min(1, amount));
    // On low-power the convolver may not exist yet — build it on first wet use.
    if (v > 0) this.ensureConvolver();
    if (this.wetGain) this.wetGain.gain.value = v;
    if (this.dryGain) this.dryGain.gain.value = 1 - v * 0.6;
  }

  setReverbPreset(preset: ReverbPreset) {
    if (!this.ctx) return;
    const p = REVERB_PRESETS[preset];
    // Lazily materialize the convolver on low-power when a wet preset is picked.
    if (p.wet > 0 && !this.ensureConvolver()) return;
    if (this.convolver) this.convolver.buffer = makeImpulseResponse(this.ctx, p.duration, p.decay, p.reverse);
    this.setReverbWet(p.wet);
  }

  async play(track: Track) {
    this.unlock();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
    // Settle the previous play() promise before mutating src. Without this
    // guard a rapid track-switch (click track 2 while track 1 is still loading)
    // throws "The play() request was interrupted by a new load request".
    if (this.playPromise) {
      try { await this.playPromise; } catch { /* prior abort is expected on rapid switch */ }
    }
    if (this.current?.id !== track.id) {
      // Pause first so the in-flight load doesn't race the new src.
      if (!this.audio.paused) this.audio.pause();
      this.current = track;
      this.reloadGuard = ''; // fresh track → allow one self-heal retry again
      this.audio.src = track.file;
      this.audio.load();
    }
    try {
      this.playPromise = this.audio.play();
      await this.playPromise;
    } catch (err) {
      // AbortError is the expected outcome when another play() superseded this
      // one — swallow silently. Surface anything else (NotAllowedError, etc.)
      // for diagnostics.
      const name = (err as { name?: string } | null)?.name;
      if (name !== 'AbortError') console.warn('audio play blocked', err);
    } finally {
      this.playPromise = null;
    }
    this.emit();
  }

  toggle() {
    if (!this.current) return;
    if (this.audio.paused) {
      this.playPromise = this.audio.play().catch(err => {
        const name = (err as { name?: string } | null)?.name;
        if (name !== 'AbortError') console.warn('audio play blocked', err);
      }) as Promise<void>;
    } else {
      this.audio.pause();
    }
  }

  seekRatio(r: number) {
    if (!Number.isFinite(this.audio.duration)) return;
    this.audio.currentTime = Math.max(0, Math.min(1, r)) * this.audio.duration;
  }

  setVolume(v: number) {
    this.audio.volume = Math.max(0, Math.min(1, v));
    this.emit();
  }

  sample() {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);
    if (this.analyserL) this.analyserL.getByteFrequencyData(this.freqL);
    if (this.analyserR) this.analyserR.getByteFrequencyData(this.freqR);
    this.detectBeat();
    this.predictDrop();
  }

  /**
   * Drop / climax predictor. Tracks RMS over the last ~4s @ 60fps (240 frames),
   * derives a normalized slope, and fires `dropImminent` when energy is building
   * faster than 1.6σ over rolling baseline AND current RMS sits in the build
   * register (0.42–0.78). 700ms cooldown prevents retriggering inside the same
   * crescendo. Visualizers read `buildPhase` for smooth choreography and
   * `dropEnergy` for strobe brightness.
   */
  private predictDrop() {
    const t = this.timeData;
    if (!t.length) return;
    let s = 0;
    for (let i = 0; i < t.length; i++) {
      const v = (t[i] - 128) / 128;
      s += v * v;
    }
    const rms = Math.sqrt(s / t.length);
    this.rms = rms;
    this.rmsHistory.push(rms);
    if (this.rmsHistory.length > 240) this.rmsHistory.shift();
    if (this.rmsHistory.length < 30) return;

    // Linear regression slope across the window — positive slope = building.
    const n = this.rmsHistory.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i; sumY += this.rmsHistory[i];
      sumXY += i * this.rmsHistory[i]; sumX2 += i * i;
    }
    const meanX = sumX / n;
    const meanY = sumY / n;
    const slope = (sumXY - n * meanX * meanY) / Math.max(1e-6, sumX2 - n * meanX * meanX);
    // Normalize slope to "RMS units per second" given ~60fps sampling.
    this.rmsFluxSlope = slope * 60;

    // Baseline σ across window for adaptive threshold.
    let varSum = 0;
    for (let i = 0; i < n; i++) varSum += (this.rmsHistory[i] - meanY) ** 2;
    const sigma = Math.sqrt(varSum / n);

    const recent = this.rmsHistory[n - 1];
    this.dropEnergy = this.dropEnergy * 0.85 + recent * 0.15;
    this.buildPhase = Math.max(0, Math.min(1, (recent - meanY) / Math.max(0.04, sigma * 2)));

    const now = performance.now();
    const buildingFast = this.rmsFluxSlope > sigma * 1.6;
    const inBuildRegister = recent > 0.42 && recent < 0.78;
    const past = now > this.dropCooldownUntil;
    this.dropImminent = false;
    if (buildingFast && inBuildRegister && past) {
      this.dropImminent = true;
      this.dropPredictedAt = now + 150;
      this.dropCooldownUntil = now + 700;
    }
  }

  /**
   * Adaptive beat detection: compares current sub-bass energy against a rolling
   * 43-frame average using a variance-scaled threshold (c = –0.0025714v + 1.5143).
   * Lower variance → higher threshold (clean signal); higher variance → lower threshold (complex mix).
   */
  private detectBeat() {
    const f = this.freqData;
    if (!f.length) return;
    const lo = 0;
    const hi = Math.floor(f.length * 0.08);
    let s = 0;
    for (let i = lo; i < hi; i++) s += f[i];
    const energy = s / Math.max(1, hi - lo) / 255;
    this.energyHistory.push(energy);
    if (this.energyHistory.length > 43) this.energyHistory.shift();
    const avg = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
    let variance = 0;
    for (const e of this.energyHistory) variance += (e - avg) ** 2;
    variance /= this.energyHistory.length;
    const c = -0.0025714 * variance + 1.5142857;
    const now = performance.now();
    if (energy > avg * c && energy > 0.18 && now - this.lastBeatAt > 220) {
      const interval = now - this.lastBeatAt;
      this.lastBeatAt = now;
      this.beatPulse = 1;
      if (interval < 1200) {
        const instantBpm = 60000 / interval;
        this.bpm = this.bpm ? this.bpm * 0.85 + instantBpm * 0.15 : instantBpm;
      }
    } else {
      this.beatPulse = Math.max(0, this.beatPulse - 0.06);
    }
  }

  channelEnergy(): { l: number; r: number } {
    const n = this.freqL.length;
    // Low-power graph has no stereo split — collapse to mono energy so the
    // visualizer's stereo-skew degrades to centered (skew 0) instead of NaN.
    if (n === 0) {
      const m = this.freqData.length;
      if (m === 0) return { l: 0, r: 0 };
      let sum = 0;
      for (let i = 0; i < m; i++) sum += this.freqData[i];
      const e = sum / m / 255;
      return { l: e, r: e };
    }
    let l = 0;
    let r = 0;
    for (let i = 0; i < n; i++) {
      l += this.freqL[i];
      r += this.freqR[i];
    }
    return { l: l / n / 255, r: r / n / 255 };
  }

  // Spectral 7-band split + spectral centroid + stereo width — visualizers
  // tap this to drive richer Web-Audio reactivity than raw beatPulse alone.
  bands(): {
    bass: number; lowMid: number; mid: number; highMid: number;
    treble: number; presence: number; brilliance: number;
    centroid: number; stereo: number; flux: number;
  } {
    const f = this.freqData;
    const n = f.length;
    if (n === 0) {
      return { bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0, presence: 0, brilliance: 0, centroid: 0, stereo: 0, flux: 0 };
    }
    const bandAvg = (lo: number, hi: number) => {
      const a = Math.max(0, Math.floor(n * lo));
      const b = Math.min(n, Math.floor(n * hi));
      let s = 0;
      for (let i = a; i < b; i++) s += f[i];
      return b > a ? (s / (b - a)) / 255 : 0;
    };
    let sumMag = 0;
    let sumWeighted = 0;
    for (let i = 0; i < n; i++) {
      const m = f[i];
      sumMag += m;
      sumWeighted += m * i;
    }
    const centroid = sumMag > 0 ? (sumWeighted / sumMag) / n : 0;
    const channelDelta = this.freqL.length === this.freqR.length && this.freqL.length > 0
      ? (() => {
          let d = 0;
          for (let i = 0; i < this.freqL.length; i++) d += Math.abs(this.freqL[i] - this.freqR[i]);
          return d / this.freqL.length / 255;
        })()
      : 0;
    return {
      bass:       bandAvg(0,    0.04),
      lowMid:     bandAvg(0.04, 0.10),
      mid:        bandAvg(0.10, 0.22),
      highMid:    bandAvg(0.22, 0.38),
      treble:     bandAvg(0.38, 0.58),
      presence:   bandAvg(0.58, 0.78),
      brilliance: bandAvg(0.78, 1.0),
      centroid,
      stereo:     channelDelta,
      flux:       Math.max(0, Math.min(1, this.rmsFluxSlope * 4 + 0.5))
    };
  }

  // Beat-locked phase 0..1 — wraps every (60/bpm) seconds. Visualizers use
  // this to align motion to tempo without recomputing per frame.
  tempoPhase(now = performance.now()): number {
    if (!this.bpm || this.bpm <= 0) return ((now / 1000) % 2) / 2;
    const periodMs = 60000 / this.bpm;
    const sinceBeat = (now - this.lastBeatAt + periodMs * 10) % periodMs;
    return sinceBeat / periodMs;
  }

  state() {
    return {
      track: this.current,
      playing: !this.audio.paused && !this.audio.ended,
      currentTime: this.audio.currentTime || 0,
      duration: this.audio.duration || 0,
      volume: this.audio.volume,
      bpm: this.bpm,
      beatPulse: this.beatPulse
    };
  }
}

/**
 * Generates a stereo exponential-decay impulse response for a ConvolverNode.
 * Simulates room reverb by filling each sample with white noise scaled by (1 - n/length)^decay.
 * Reverse=true creates a reverse-reverb (swell) effect.
 */
function makeImpulseResponse(
  ctx: AudioContext,
  durationSec: number,
  decay: number,
  reverse: boolean
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const buffer = ctx.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const n = reverse ? length - i : i;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, decay);
    }
  }
  return buffer;
}
