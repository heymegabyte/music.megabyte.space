// Philips Hue Bridge integration — Spotify-style live light sync.
// Direct browser → bridge calls (bridge ships CORS headers; user accepts self-signed
// cert once via /api/hue/redirect or by visiting the bridge IP). Worker proxy at
// /api/hue/discover handles the cloud broker. Rate-limited to ~9Hz per Hue dev guidance.
//
// BLE direct path: when the user pairs a single Hue bulb over Web Bluetooth (Chrome
// desktop / Android), pulses are written straight to GATT — sub-100ms latency, no
// bridge required. Falls back to HTTPS bridge automatically when BLE is unavailable.

import { rgbToXY, rgbBrightness } from './palette';

export interface HueConfig {
  bridgeIp: string;
  appKey: string;
  groupId?: string;
  intensity: number;          // 0-1 user knob
  enabled: boolean;
  /** When true, drive Play Light Bars / gradient strips via CLIP v2 multi-point frames at ~25Hz. */
  useGradient: boolean;
}

export interface HueGroup {
  id: string;                 // v1 group id (string number, e.g. "1")
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

/** Per-frame audio signal driving the gradient. */
export interface HueBands {
  bass: number;       // 0-1 (0-150Hz region)
  mid: number;        // 0-1 (150Hz-2kHz region)
  treble: number;     // 0-1 (2kHz+)
  beat: number;       // 0-1 transient kick pulse
  bpm?: number;       // for tempo-locked color drift
  /** True for ~150ms before AudioEngine predicts a bass drop. Triggers white strobe. */
  dropImminent?: boolean;
  /** 0-1 smoothed RMS — climbs during a build, drives sustained pre-drop brightness lift. */
  dropEnergy?: number;
  /** 0-1 build-phase slope — when >0.5 we're in a crescendo, palette sweep accelerates. */
  buildPhase?: number;
}

const STORAGE_KEY = 'bz:hue:v1';
const BLE_DEVICE_KEY = 'bz:hue:ble:v1';
const MIN_FRAME_MS = 110;     // ~9Hz — bridge HTTPS v1 endpoint hard-throttles ~10Hz
const MIN_V2_MS = 45;         // ~22Hz — CLIP v2 sustains higher cadence than v1
const MIN_BLE_MS = 200;       // ~5Hz — gentle on the BLE link, dodges flooding the bulb

// Reverse-engineered Philips Hue BLE GATT (matches Hue White & Color Ambiance bulbs).
const HUE_BLE_SERVICE = '932c32bd-0000-47a2-835a-a8d455b859dd';
const HUE_BLE_ON_CHAR = '932c32bd-0002-47a2-835a-a8d455b859dd';
const HUE_BLE_BRI_CHAR = '932c32bd-0003-47a2-835a-a8d455b859dd';
const HUE_BLE_XY_CHAR = '932c32bd-0005-47a2-835a-a8d455b859dd';

// Minimal Web Bluetooth shape — @types/web-bluetooth isn't installed and we only
// touch a thin slice of the API. Anything broader can be added when needed.
interface BluetoothRemoteGATTCharacteristic {
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
}
interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>;
}
interface BluetoothRemoteGATTServer {
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>;
}
interface BluetoothDevice {
  id?: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void;
}
interface BluetoothRequestOptions {
  filters?: Array<{ services?: string[]; namePrefix?: string }>;
  optionalServices?: string[];
}
interface BluetoothApi {
  requestDevice(opts: BluetoothRequestOptions): Promise<BluetoothDevice>;
  getDevices?: () => Promise<BluetoothDevice[]>;
}
declare global {
  interface Navigator { bluetooth?: BluetoothApi; }
}

export class HueSync {
  config: HueConfig;
  groups: HueGroup[] = [];
  gradientLights: GradientLight[] = [];
  status: 'idle' | 'discovering' | 'linking' | 'ready' | 'error' = 'idle';
  lastError = '';
  bleConnected = false;
  bleDeviceName = '';
  bleSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  private lastFrameAt = 0;
  private lastV2At = 0;
  private lastBleAt = 0;
  private listeners = new Set<() => void>();
  private inflight = 0;
  private v2Inflight = 0;
  private smoothed: [number, number, number] = [12, 16, 24];
  private secondary: [number, number, number] = [124, 58, 237];
  /** Full per-track palette. Falls back to [accent, secondary] if `setPalette` not called. */
  private paletteRgb: Array<[number, number, number]> = [[0, 229, 255], [124, 58, 237]];
  /** Phase counter — advances on every frame, kicks forward on beat. Drives sweep. */
  private phase = 0;
  /** Smoothed bands per zone, indexed by zone position. Re-allocated when zones change. */
  private zoneBri: number[] = [];
  private bleDevice: BluetoothDevice | null = null;
  private bleServer: BluetoothRemoteGATTServer | null = null;
  private bleOnChar: BluetoothRemoteGATTCharacteristic | null = null;
  private bleBriChar: BluetoothRemoteGATTCharacteristic | null = null;
  private bleXyChar: BluetoothRemoteGATTCharacteristic | null = null;
  private bleBusy = false;

  constructor() {
    this.config = readConfig();
    if (this.config.bridgeIp && this.config.appKey) {
      this.status = 'ready';
      void this.loadGradientLights();
    }
    void this.tryReconnectBle();
  }

  on(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) {
      try { l(); } catch { /* noop */ }
    }
  }

  /** Cloud-broker discovery via Worker proxy (avoids CORS surprises). */
  async discover(): Promise<{ id: string; ip: string }[]> {
    this.status = 'discovering';
    this.emit();
    try {
      const res = await fetch('/api/hue/discover', { cache: 'no-store' });
      if (!res.ok) throw new Error(`discover ${res.status}`);
      const arr = await res.json() as Array<{ id: string; internalipaddress: string }>;
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
      const data = await res.json() as Array<{ success?: { username?: string; clientkey?: string }; error?: { type?: number; description?: string } }>;
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
      const res = await fetch(`https://${this.config.bridgeIp}/api/${this.config.appKey}/groups`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`groups ${res.status}`);
      const data = await res.json() as Record<string, { name: string; type: string }>;
      this.groups = Object.entries(data).map(([id, g]) => {
        const t = (g.type ?? '').toLowerCase();
        return {
          id,
          name: g.name ?? `Group ${id}`,
          type: (t === 'entertainment' ? 'entertainment'
            : t === 'room' ? 'room'
            : t === 'zone' ? 'zone' : 'other') as HueGroup['type']
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
      const json = await res.json() as { data?: Array<{
        id: string;
        metadata?: { name?: string };
        gradient?: { points_capable?: number };
      }> };
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
    if (this.bleConnected) return true;
    if (!this.config.bridgeIp || !this.config.appKey) return false;
    // v1 group OR v2 gradient lights — either path is enough to drive the room
    return Boolean(this.config.groupId) || (this.config.useGradient && this.gradientLights.length > 0);
  }

  /**
   * Pair a single Hue bulb over Web Bluetooth (Chrome desktop / Android only).
   * GATT writes give sub-100ms latency vs ~800ms over the bridge HTTPS endpoint.
   * Must be called inside a user gesture handler (browser security requirement).
   */
  async connectBLE(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.bleSupported || !navigator.bluetooth) return { ok: false, reason: 'Web Bluetooth not supported in this browser. Try Chrome on desktop or Android.' };
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: [HUE_BLE_SERVICE] },
          { namePrefix: 'Hue' }
        ],
        optionalServices: [HUE_BLE_SERVICE]
      });
      await this.bindBleDevice(device);
      try { localStorage.setItem(BLE_DEVICE_KEY, device.id ?? device.name ?? ''); } catch { /* noop */ }
      this.config = { ...this.config, enabled: true };
      writeConfig(this.config);
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.bleConnected = false;
      this.lastError = msg.includes('cancelled') || msg.includes('User cancelled') ? 'Pairing cancelled' : msg;
      this.emit();
      return { ok: false, reason: this.lastError };
    }
  }

  /** Reconnect to a previously-paired bulb without showing the chooser. Chrome-only API. */
  private async tryReconnectBle(): Promise<void> {
    if (!this.bleSupported || !navigator.bluetooth?.getDevices) return;
    let savedId = '';
    try { savedId = localStorage.getItem(BLE_DEVICE_KEY) ?? ''; } catch { /* noop */ }
    if (!savedId) return;
    try {
      const devices = await navigator.bluetooth.getDevices();
      const match = devices.find((d: BluetoothDevice) => d.id === savedId || d.name === savedId);
      if (!match) return;
      // Wait for advertising — Chrome dispatches `advertisementreceived` only when the
      // bulb is in range and discoverable. Fall back to direct connect attempt.
      await this.bindBleDevice(match);
    } catch { /* silent — user can re-pair via UI */ }
  }

  private async bindBleDevice(device: BluetoothDevice): Promise<void> {
    if (!device.gatt) throw new Error('Device has no GATT server');
    device.addEventListener('gattserverdisconnected', () => this.handleBleDisconnect());
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(HUE_BLE_SERVICE);
    const [onChar, briChar, xyChar] = await Promise.all([
      service.getCharacteristic(HUE_BLE_ON_CHAR).catch(() => null),
      service.getCharacteristic(HUE_BLE_BRI_CHAR).catch(() => null),
      service.getCharacteristic(HUE_BLE_XY_CHAR).catch(() => null)
    ]);
    if (!xyChar) throw new Error('Bulb does not advertise the color characteristic — is this a White & Color Ambiance bulb?');
    this.bleDevice = device;
    this.bleServer = server;
    this.bleOnChar = onChar;
    this.bleBriChar = briChar;
    this.bleXyChar = xyChar;
    this.bleConnected = true;
    this.bleDeviceName = device.name ?? 'Hue bulb';
    this.lastError = '';
    this.emit();
  }

  private handleBleDisconnect(): void {
    this.bleConnected = false;
    this.bleServer = null;
    this.bleOnChar = null;
    this.bleBriChar = null;
    this.bleXyChar = null;
    this.emit();
  }

  disconnectBLE(): void {
    try { this.bleServer?.disconnect(); } catch { /* noop */ }
    try { localStorage.removeItem(BLE_DEVICE_KEY); } catch { /* noop */ }
    this.bleDevice = null;
    this.handleBleDisconnect();
  }

  /**
   * Drive lights from current audio frame.
   * @param accentRgb - palette accent for ambient color (drives v1 group action)
   * @param bands - bass/mid/treble + beat for multi-zone gradient frames
   */
  async pulse(accentRgb: [number, number, number], bands: HueBands): Promise<void> {
    if (!this.isReady()) return;

    const { bass: bassEnergy, beat: beatPulse } = bands;
    this.smoothed = [
      this.smoothed[0] * 0.7 + accentRgb[0] * 0.3,
      this.smoothed[1] * 0.7 + accentRgb[1] * 0.3,
      this.smoothed[2] * 0.7 + accentRgb[2] * 0.3
    ];
    // Drop predictor override: AudioEngine flips `dropImminent` ~150ms before the kick,
    // and `dropEnergy` ramps through the build. Together they wash the bar to white
    // just-in-time so the strobe lands ON the drop, not behind it.
    const dropFlash = bands.dropImminent ? 1 : 0;
    const buildLift = Math.max(0, Math.min(1, bands.dropEnergy ?? 0));
    const flash = Math.max(0, Math.min(1, Math.max(beatPulse, dropFlash)));
    const r = this.smoothed[0] + (255 - this.smoothed[0]) * flash * 0.55;
    const g = this.smoothed[1] + (255 - this.smoothed[1]) * flash * 0.55;
    const b = this.smoothed[2] + (255 - this.smoothed[2]) * flash * 0.55;

    const intensity = this.config.intensity;
    const baseBri = rgbBrightness(r, g, b);
    // During the build, lift the brightness floor so the room visibly rides the
    // crescendo before the strobe punches white at the drop.
    const briFloor = 0.06 + buildLift * 0.35;
    const modulated = Math.max(briFloor, Math.min(1, baseBri * (0.55 + 0.45 * bassEnergy * (0.4 + 0.6 * intensity))));
    const bri = Math.max(1, Math.round(modulated * 254));
    const xy = rgbToXY(r, g, b);

    if (this.bleConnected && this.bleXyChar) {
      const now = performance.now();
      // Drop frames bypass the 200ms BLE throttle so the strobe is never dropped on the floor.
      if (!bands.dropImminent && now - this.lastBleAt < MIN_BLE_MS) return;
      if (this.bleBusy) return;
      this.lastBleAt = now;
      this.bleBusy = true;
      try {
        // Hue BLE color: 4 bytes little-endian — x:uint16 y:uint16 normalized 0..0xFFFF
        const xRaw = Math.max(0, Math.min(0xFFFF, Math.round(xy[0] * 0xFFFF)));
        const yRaw = Math.max(0, Math.min(0xFFFF, Math.round(xy[1] * 0xFFFF)));
        const xyBuf = new Uint8Array([xRaw & 0xFF, (xRaw >> 8) & 0xFF, yRaw & 0xFF, (yRaw >> 8) & 0xFF]);
        await this.bleXyChar.writeValueWithoutResponse(xyBuf);
        if (this.bleBriChar) {
          await this.bleBriChar.writeValueWithoutResponse(new Uint8Array([bri]));
        }
      } catch (err) {
        // GATT failure usually means the bulb went out of range — drop to disconnected.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('GATT') || msg.includes('disconnected')) this.handleBleDisconnect();
      } finally {
        this.bleBusy = false;
      }
      return;
    }

    if (!this.config.bridgeIp || !this.config.appKey) return;

    // CLIP v2 multi-zone gradient streaming for Light Bars / gradient strips.
    // Runs in parallel with the v1 group action — the v1 PUT keeps non-gradient
    // bulbs in the same room reactive, while v2 paints each light's zones.
    if (this.config.useGradient && this.gradientLights.length) {
      void this.streamGradient(bands, flash, bri);
    }

    if (!this.config.groupId) return;
    const now = performance.now();
    if (now - this.lastFrameAt < MIN_FRAME_MS) return;
    if (this.inflight >= 2) return;
    this.lastFrameAt = now;

    const url = `https://${this.config.bridgeIp}/api/${this.config.appKey}/groups/${this.config.groupId}/action`;
    const body = { on: true, bri, xy, transitiontime: 1 };

    this.inflight += 1;
    try {
      await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: true
      });
    } catch { /* swallow — keep visualizer ticking */ }
    finally { this.inflight = Math.max(0, this.inflight - 1); }
  }

  /**
   * Push a fresh gradient frame to every gradient-capable light.
   *
   * Visual model — what makes Hue Play Light Bars actually look legit:
   *   - **Zone-band mapping.** zone[0] = bass (warm, dense), zone[mid] = mid (accent),
   *     zone[end] = treble (bright, airy). Each zone's brightness modulated by its
   *     own band's energy, so kicks light up the bass zone, hi-hats sparkle the top.
   *   - **Palette sweep.** Each frame rotates which palette swatch lands on which
   *     zone via `phase` — phase ticks every frame, kicks forward on each beat.
   *     Result: color travels across the bar like a wave, never static.
   *   - **Per-light phase offset.** Two bars flanking a TV mirror but offset by
   *     half a beat (lightIdx × half-period), so they don't pulse in lockstep.
   *   - **Tempo drift.** When BPM is known, phase advances proportionally so the
   *     wave speed matches the song. No BPM = constant 22Hz drift.
   *   - **Beat burst.** On every detected kick, zone[0] briefly washes toward
   *     white over the bass color underneath. That's the Spotify-canvas snap.
   */
  private async streamGradient(bands: HueBands, flash: number, bri: number): Promise<void> {
    const now = performance.now();
    // Drop-imminent frames bypass the 45ms v2 throttle so the strobe lands on the kick.
    if (!bands.dropImminent && now - this.lastV2At < MIN_V2_MS) return;
    if (this.v2Inflight >= 3) return;
    this.lastV2At = now;

    // Phase advances ~1 step per frame, kicks forward on beat for snappy travel.
    // BPM scales the base step so 60 BPM ≈ 1 step / frame, 140 BPM ≈ 2.3 / frame.
    // During a build (`buildPhase` rising), accelerate the sweep so color travel
    // visibly speeds into the drop — the eye reads it as tension before release.
    const bpmScale = bands.bpm && bands.bpm > 30 ? bands.bpm / 60 : 1;
    const buildAccel = 1 + (bands.buildPhase ?? 0) * 1.5;
    this.phase = (this.phase + 0.08 * bpmScale * buildAccel + flash * 1.4) % 1024;

    const briPct = Math.max(1, Math.min(100, Math.round((bri / 254) * 100)));
    const palette = this.paletteRgb;

    let lightIdx = 0;
    for (const light of this.gradientLights) {
      const points = Math.max(2, Math.min(5, light.points));
      const lightOffset = lightIdx * 0.37;  // staggers bars so they're not clones
      const zones: Array<{ color: { xy: { x: number; y: number } } }> = [];

      for (let i = 0; i < points; i++) {
        const t = i / (points - 1);                 // 0 = bass end, 1 = treble end
        // Pick band per zone: lerp bass→mid→treble across positions.
        const zoneBand = t < 0.5
          ? bands.bass * (1 - t * 2) + bands.mid * (t * 2)
          : bands.mid * (1 - (t - 0.5) * 2) + bands.treble * ((t - 0.5) * 2);

        // Pick palette swatch via rotating phase + per-light offset + zone index.
        const swatchIdx = Math.floor(this.phase * 0.05 + lightOffset + i * 0.6) % palette.length;
        const baseColor = palette[(swatchIdx + palette.length) % palette.length];

        // White burst on zone[0] when beat hits (the kick snap). On a predicted drop,
        // every zone washes toward white — full-bar strobe, not just the bass end.
        const dropAll = bands.dropImminent ? 0.9 : 0;
        const beatBurst = i === 0 ? flash * 0.75 : i === 1 ? flash * 0.35 : 0;
        const burst = Math.max(beatBurst, dropAll);
        const r = baseColor[0] + (255 - baseColor[0]) * burst;
        const g = baseColor[1] + (255 - baseColor[1]) * burst;
        const b = baseColor[2] + (255 - baseColor[2]) * burst;

        // Per-zone brightness via that zone's band energy. Floor at 30% so dark
        // sections don't go fully black between transients.
        const zoneAmp = 0.30 + 0.70 * zoneBand;
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
        .catch(() => { /* swallow — keep frames flowing */ })
        .finally(() => { this.v2Inflight = Math.max(0, this.v2Inflight - 1); });
      lightIdx += 1;
    }
  }

  async setOn(on: boolean): Promise<void> {
    if (this.bleConnected && this.bleOnChar) {
      try {
        await this.bleOnChar.writeValueWithoutResponse(new Uint8Array([on ? 1 : 0]));
      } catch { /* noop */ }
      return;
    }
    if (!this.config.bridgeIp || !this.config.appKey || !this.config.groupId) return;
    try {
      await fetch(`https://${this.config.bridgeIp}/api/${this.config.appKey}/groups/${this.config.groupId}/action`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on, transitiontime: 4 })
      });
    } catch { /* noop */ }
  }
}

function readConfig(reset = false): HueConfig {
  if (reset) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch { /* noop */ }
}

export const hue = new HueSync();
