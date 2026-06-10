// Philips Hue Bridge integration — Spotify-style live light sync.
// Direct browser → bridge calls (bridge ships CORS headers; user accepts self-signed
// cert once via /api/hue/redirect or by visiting the bridge IP). Worker proxy at
// /api/hue/discover handles the cloud broker. Rate-limited to ~9Hz per Hue dev guidance.
// CLIP v2 multi-zone gradient streaming drives Hue Play Light Bars and gradient
// strips at ~22Hz with per-zone color + brightness.

import { rgbToXY, rgbBrightness } from './palette';

export interface HueConfig {
  bridgeIp: string;
  appKey: string;
  groupId?: string;
  intensity: number; // 0-1 user knob
  enabled: boolean;
  /** When true, drive Play Light Bars / gradient strips via CLIP v2 multi-point frames at ~25Hz. */
  useGradient: boolean;
}

export interface HueGroup {
  id: string; // v1 group id (string number, e.g. "1")
  name: string;
  type: 'room' | 'zone' | 'entertainment' | 'other';
}

export interface GradientLight {
  /** CLIP v2 light resource id (uuid). */
  id: string;
  name: string;
  /** Number of color zones the device supports (Play Light Bar = 3, Lightstrip Plus = 5+). */
  points: number;
}

/** Per-frame audio signal driving the gradient. Lights are aesthetic-only —
 *  only `bass`/`mid`/`treble` modulate brightness; transient drop/build
 *  predictors are accepted for API stability but ignored (no strobing). */
export interface HueBands {
  bass: number; // 0-1 (0-150Hz region)
  mid: number; // 0-1 (150Hz-2kHz region)
  treble: number; // 0-1 (2kHz+)
  beat: number; // 0-1 transient kick pulse (ignored — aesthetic mode)
  bpm?: number; // (ignored — phase drift is constant)
  /** Accepted for API stability — ignored in aesthetic mode. */
  dropImminent?: boolean;
  /** Accepted for API stability — ignored in aesthetic mode. */
  dropEnergy?: number;
  /** Accepted for API stability — ignored in aesthetic mode. */
  buildPhase?: number;
}

const STORAGE_KEY = 'bz:hue:v1';
const MIN_FRAME_MS = 110; // ~9Hz — bridge HTTPS v1 endpoint hard-throttles ~10Hz
const MIN_V2_MS = 45; // ~22Hz — CLIP v2 sustains higher cadence than v1

export class HueSync {
  config: HueConfig;
  groups: HueGroup[] = [];
  gradientLights: GradientLight[] = [];
  status: 'idle' | 'discovering' | 'linking' | 'ready' | 'error' = 'idle';
  lastError = '';
  private lastFrameAt = 0;
  private lastV2At = 0;
  private listeners = new Set<() => void>();
  private inflight = 0;
  private v2Inflight = 0;
  private smoothed: [number, number, number] = [12, 16, 24];
  private secondary: [number, number, number] = [124, 58, 237];
  /** Full per-track palette. Falls back to [accent, secondary] if `setPalette` not called. */
  private paletteRgb: Array<[number, number, number]> = [
    [0, 229, 255],
    [124, 58, 237]
  ];
  /** Phase counter — advances on every frame, kicks forward on beat. Drives sweep. */
  private phase = 0;
  /** Smoothed bands per zone, indexed by zone position. Re-allocated when zones change. */
  private zoneBri: number[] = [];

  constructor() {
    this.config = readConfig();
    if (this.config.bridgeIp && this.config.appKey) {
      this.status = 'ready';
      void this.loadGradientLights();
    }
  }

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* noop */
      }
    }
  }

  /** Cloud-broker discovery via Worker proxy (avoids CORS surprises). */
  async discover(): Promise<{ id: string; ip: string }[]> {
    this.status = 'discovering';
    this.emit();
    try {
      const res = await fetch('/api/hue/discover', { cache: 'no-store' });
      if (!res.ok) throw new Error(`discover ${res.status}`);
      const arr = (await res.json()) as Array<{ id: string; internalipaddress: string }>;
      this.status = arr.length ? 'idle' : 'error';
      if (!arr.length) this.lastError = 'No bridges found on your network';
      this.emit();
      return arr.map(b => ({ id: b.id, ip: b.internalipaddress }));
    } catch (err: unknown) {
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit();
      return [];
    }
  }

  /** v1 link-button auth — POST to bridge directly. User must press the round button first. */
  async link(bridgeIp: string): Promise<{ ok: boolean; reason?: string }> {
    if (!bridgeIp) return { ok: false, reason: 'missing bridge ip' };
    const ip = bridgeIp.trim();
    this.status = 'linking';
    this.lastError = '';
    this.emit();
    try {
      const res = await fetch(`https://${ip}/api`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ devicetype: 'bz-music#cast', generateclientkey: true })
      });
      const data = (await res.json()) as Array<{
        success?: { username?: string; clientkey?: string };
        error?: { type?: number; description?: string };
      }>;
      const first = Array.isArray(data) ? data[0] : null;
      if (first?.success?.username) {
        this.config = { ...this.config, bridgeIp: ip, appKey: first.success.username, enabled: true };
        writeConfig(this.config);
        this.status = 'ready';
        this.emit();
        await this.loadGroups();
        await this.loadGradientLights();
        return { ok: true };
      }
      const reason = first?.error?.description ?? 'unknown error';
      this.lastError = reason;
      this.status = 'error';
      this.emit();
      return { ok: false, reason };
    } catch (err: unknown) {
      this.status = 'error';
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg.includes('Failed to fetch')
        ? 'Cannot reach bridge — visit https://' + ip + ' once and accept the certificate, then try again.'
        : msg;
      this.emit();
      return { ok: false, reason: this.lastError };
    }
  }

  async loadGroups(): Promise<HueGroup[]> {
    if (!this.config.bridgeIp || !this.config.appKey) return [];
    try {
      const res = await fetch(`https://${this.config.bridgeIp}/api/${this.config.appKey}/groups`, {
        cache: 'no-store'
      });
      if (!res.ok) throw new Error(`groups ${res.status}`);
      const data = (await res.json()) as Record<string, { name: string; type: string }>;
      this.groups = Object.entries(data).map(([id, g]) => {
        const t = (g.type ?? '').toLowerCase();
        return {
          id,
          name: g.name ?? `Group ${id}`,
          type: (t === 'entertainment'
            ? 'entertainment'
            : t === 'room'
              ? 'room'
              : t === 'zone'
                ? 'zone'
                : 'other') as HueGroup['type']
        };
      });
      // Always ensure synthetic "All lights" group
      if (!this.groups.find(g => g.id === '0')) {
        this.groups.unshift({ id: '0', name: 'All lights', type: 'other' });
      }
      this.emit();
      return this.groups;
    } catch (err: unknown) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit();
      return [];
    }
  }

  /**
   * Enumerate gradient-capable lights via CLIP v2 (Hue Play Light Bar = 3 zones,
   * Lightstrip Plus / Festavia / Signe = 5+ zones). Stored in `gradientLights`
   * and used by `pulse()` when `useGradient` is on. v2 endpoints accept higher
   * frame rates (~25Hz vs v1's 9Hz) and let us paint each zone independently.
   */
  async loadGradientLights(): Promise<GradientLight[]> {
    if (!this.config.bridgeIp || !this.config.appKey) return [];
    try {
      const res = await fetch(`https://${this.config.bridgeIp}/clip/v2/resource/light`, {
        cache: 'no-store',
        headers: { 'hue-application-key': this.config.appKey }
      });
      if (!res.ok) throw new Error(`v2 lights ${res.status}`);
      const json = (await res.json()) as {
        data?: Array<{
          id: string;
          metadata?: { name?: string };
          gradient?: { points_capable?: number };
        }>;
      };
      const data = json.data ?? [];
      this.gradientLights = data
        .filter(l => typeof l.gradient?.points_capable === 'number' && (l.gradient.points_capable ?? 0) >= 2)
        .map(l => ({
          id: l.id,
          name: l.metadata?.name ?? 'Gradient light',
          points: l.gradient!.points_capable!
        }));
      this.emit();
      return this.gradientLights;
    } catch (err: unknown) {
      // Pre-2021 bridges (V1 hub) have no /clip/v2 endpoint. Treat as zero gradient lights.
      this.gradientLights = [];
      this.lastError = err instanceof Error ? err.message : String(err);
      this.emit();
      return [];
    }
  }

  setGroup(id: string) {
    this.config = { ...this.config, groupId: id };
    writeConfig(this.config);
    this.emit();
  }

  setUseGradient(v: boolean) {
    this.config = { ...this.config, useGradient: v };
    writeConfig(this.config);
    this.emit();
  }

  /**
   * Cache the current track's full palette so `pulse()` can paint each gradient
   * zone with a different swatch. Pass the album-art swatch array (3-5 colors,
   * dominant first). Called once per track change from the visualizer.
   */
  setPalette(rgb: Array<[number, number, number]>) {
    if (!rgb.length) return;
    this.paletteRgb = rgb.map(c => [...c] as [number, number, number]);
    this.smoothed = [...rgb[0]] as [number, number, number];
    this.secondary = [...(rgb[rgb.length - 1] ?? rgb[0])] as [number, number, number];
  }

  setIntensity(v: number) {
    this.config = { ...this.config, intensity: Math.max(0, Math.min(1, v)) };
    writeConfig(this.config);
    this.emit();
  }

  setEnabled(v: boolean) {
    this.config = { ...this.config, enabled: v };
    writeConfig(this.config);
    this.emit();
  }

  unlink() {
    this.config = readConfig(true);
    this.groups = [];
    this.gradientLights = [];
    this.status = 'idle';
    this.emit();
  }

  isReady(): boolean {
    if (!this.config.enabled) return false;
    if (!this.config.bridgeIp || !this.config.appKey) return false;
    // v1 group OR v2 gradient lights — either path is enough to drive the room
    return Boolean(this.config.groupId) || (this.config.useGradient && this.gradientLights.length > 0);
  }

  /**
   * Drive lights from current audio frame — aesthetic ambient mode.
   * Heavy smoothing + low refresh + no transient kicks: the room reads as
   * mood lighting that gently breathes with the bass. All snap/strobe/drop
   * behavior was removed — the on-screen visualizer carries the music
   * detail via Web Audio API analyser, while the lights stay calm.
   * @param accentRgb - palette accent for ambient color (drives v1 group action)
   * @param bands - bass/mid/treble for gentle per-zone brightness modulation
   */
  async pulse(accentRgb: [number, number, number], bands: HueBands): Promise<void> {
    if (!this.isReady()) return;

    const { bass: bassEnergy } = bands;
    // Heavy smoothing on the accent color so the bar drifts between palette
    // shades instead of snapping. Aesthetic background light, not a strobe.
    this.smoothed = [
      this.smoothed[0] * 0.92 + accentRgb[0] * 0.08,
      this.smoothed[1] * 0.92 + accentRgb[1] * 0.08,
      this.smoothed[2] * 0.92 + accentRgb[2] * 0.08
    ];
    const r = this.smoothed[0];
    const g = this.smoothed[1];
    const b = this.smoothed[2];

    const intensity = this.config.intensity;
    const baseBri = rgbBrightness(r, g, b);
    // Gentle bass-driven breath. Floor at 35% so the room never goes dark.
    // Top out at 80% so the lights ride softly above the screen rather than
    // dominating the room.
    const modulated = Math.max(
      0.35,
      Math.min(0.8, baseBri * (0.55 + 0.25 * bassEnergy * (0.4 + 0.6 * intensity)))
    );
    const bri = Math.max(1, Math.round(modulated * 254));
    const xy = rgbToXY(r, g, b);

    if (!this.config.bridgeIp || !this.config.appKey) return;

    // CLIP v2 multi-zone gradient streaming for Light Bars / gradient strips.
    // Runs in parallel with the v1 group action — the v1 PUT keeps non-gradient
    // bulbs in the same room reactive, while v2 paints each light's zones.
    if (this.config.useGradient && this.gradientLights.length) {
      void this.streamGradient(bands, bri);
    }

    if (!this.config.groupId) return;
    const now = performance.now();
    if (now - this.lastFrameAt < MIN_FRAME_MS) return;
    if (this.inflight >= 2) return;
    this.lastFrameAt = now;

    const url = `https://${this.config.bridgeIp}/api/${this.config.appKey}/groups/${this.config.groupId}/action`;
    // transitiontime: 4 = 400ms — Hue blends between frames instead of snapping,
    // so the bar drifts like a slow lava lamp rather than a strobe.
    const body = { on: true, bri, xy, transitiontime: 4 };

    this.inflight += 1;
    try {
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true
      });
    } catch {
      /* swallow — keep visualizer ticking */
    } finally {
      this.inflight = Math.max(0, this.inflight - 1);
    }
  }

  /**
   * Push a slow ambient gradient frame to every gradient-capable light.
   *
   * Aesthetic-only model — the lights are background mood, not a club rig:
   *   - **Zone-band mapping.** zone[0] = bass region, zone[end] = treble.
   *     Per-zone brightness modulates softly with that band's energy.
   *   - **Slow palette drift.** Phase advances at a constant 0.02 / frame
   *     regardless of tempo or build phase, so color travels like a lava
   *     lamp instead of racing into a drop.
   *   - **Per-light phase offset.** Two bars flanking a TV stagger so they
   *     don't drift in lockstep.
   *   - **No beat burst, no drop strobe, no build acceleration.** Detail
   *     work belongs on screen (Web Audio API canvas), not in the room.
   */
  private async streamGradient(bands: HueBands, bri: number): Promise<void> {
    const now = performance.now();
    // Hard throttle to ~5Hz. Aesthetic background — no strobes, no drop bypass.
    if (now - this.lastV2At < MIN_V2_MS * 4) return;
    if (this.v2Inflight >= 2) return;
    this.lastV2At = now;

    // Constant slow drift — phase moves at one rate regardless of tempo or
    // build phase. The room reads as ambient mood lighting, not a club.
    this.phase = (this.phase + 0.02) % 1024;

    const briPct = Math.max(1, Math.min(100, Math.round((bri / 254) * 100)));
    const palette = this.paletteRgb;

    let lightIdx = 0;
    for (const light of this.gradientLights) {
      const points = Math.max(2, Math.min(5, light.points));
      const lightOffset = lightIdx * 0.37; // staggers bars so they're not clones
      const zones: Array<{ color: { xy: { x: number; y: number } } }> = [];

      for (let i = 0; i < points; i++) {
        const t = i / (points - 1); // 0 = bass end, 1 = treble end
        // Heavily-smoothed per-zone band energy. Gentle wash, no transients.
        const zoneBand =
          t < 0.5
            ? bands.bass * (1 - t * 2) + bands.mid * (t * 2)
            : bands.mid * (1 - (t - 0.5) * 2) + bands.treble * ((t - 0.5) * 2);

        // Pick palette swatch via slow rotating phase + per-light offset + zone index.
        const swatchIdx = Math.floor(this.phase * 0.05 + lightOffset + i * 0.6) % palette.length;
        const baseColor = palette[(swatchIdx + palette.length) % palette.length];

        // No white burst, no drop strobe — just the palette color modulated by
        // gentle per-zone amplitude. Floor at 55% so dark sections stay lit.
        const r = baseColor[0];
        const g = baseColor[1];
        const b = baseColor[2];

        const zoneAmp = 0.55 + 0.25 * zoneBand;
        const zoneR = Math.round(r * zoneAmp);
        const zoneG = Math.round(g * zoneAmp);
        const zoneB = Math.round(b * zoneAmp);
        const xy = rgbToXY(Math.max(zoneR, 1), Math.max(zoneG, 1), Math.max(zoneB, 1));
        zones.push({ color: { xy: { x: xy[0], y: xy[1] } } });
      }

      const url = `https://${this.config.bridgeIp}/clip/v2/resource/light/${light.id}`;
      const body = {
        on: { on: true },
        dimming: { brightness: briPct },
        gradient: { points: zones, mode: 'interpolated_palette' }
      };
      this.v2Inflight += 1;
      fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'hue-application-key': this.config.appKey
        },
        body: JSON.stringify(body),
        keepalive: true
      })
        .catch(() => {
          /* swallow — keep frames flowing */
        })
        .finally(() => {
          this.v2Inflight = Math.max(0, this.v2Inflight - 1);
        });
      lightIdx += 1;
    }
  }

  async setOn(on: boolean): Promise<void> {
    if (!this.config.bridgeIp || !this.config.appKey || !this.config.groupId) return;
    try {
      await fetch(
        `https://${this.config.bridgeIp}/api/${this.config.appKey}/groups/${this.config.groupId}/action`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ on, transitiontime: 4 })
        }
      );
    } catch {
      /* noop */
    }
  }
}

function readConfig(reset = false): HueConfig {
  if (reset) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
    return { bridgeIp: '', appKey: '', intensity: 0.7, enabled: false, useGradient: true };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { bridgeIp: '', appKey: '', intensity: 0.7, enabled: false, useGradient: true };
    const parsed = JSON.parse(raw) as Partial<HueConfig>;
    return {
      bridgeIp: parsed.bridgeIp ?? '',
      appKey: parsed.appKey ?? '',
      groupId: parsed.groupId,
      intensity: typeof parsed.intensity === 'number' ? parsed.intensity : 0.7,
      enabled: parsed.enabled ?? false,
      useGradient: parsed.useGradient ?? true
    };
  } catch {
    return { bridgeIp: '', appKey: '', intensity: 0.7, enabled: false, useGradient: true };
  }
}

function writeConfig(c: HueConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* noop */
  }
}

export const hue = new HueSync();
