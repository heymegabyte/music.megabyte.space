// Chromecast Sender API bridge. Lazy-loaded on first user gesture.
// Owns full session lifecycle, state mirror, position sync, queue, idle reasons,
// volume mirror, AND a custom message channel for bidirectional sync with the
// custom receiver at /cast-receiver/. Heartbeat ticks both directions to detect
// silent drops; auto-falls-back to default media receiver if custom App ID is
// unregistered or unreachable.

import type { Track } from './types';
import { asScriptURL } from './trusted-types';
import {
  CAST_NAMESPACE,
  CAST_APP_ID,
  RECEIVER_FALLBACK,
  PROTOCOL_VERSION,
  SENDER_TICK_HZ,
  STALE_MS,
  packMsg,
  isCastMsg,
  type CastMsg,
  type ReceiverState,
  type ReceiverQueueItem,
  type ReceiverLine,
  type QueueLoadPayload,
  type SeekPayload,
  type VolumePayload,
  type MutePayload,
  type SelectPayload,
  type InsertPayload,
  type RemovePayload,
  type ReorderPayload,
  type ViewPayload,
  type PalettePayload,
  type LyricsPayload,
  type HelloPayload,
  type ErrorPayload,
  type LogPayload
} from './cast-protocol';

declare global {
  interface Window {
    __onGCastApiAvailable?: (available: boolean) => void;
    cast?: any;
    chrome?: { cast?: any };
  }
}

const CAST_FRAMEWORK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const SITE_ORIGIN = 'https://music.megabyte.space';
const APP_VERSION = '1.0.0';

export type CastEvent =
  | { type: 'available'; available: boolean }
  | { type: 'session'; active: boolean; deviceName?: string }
  | { type: 'progress'; currentTime: number; duration: number }
  | { type: 'state'; playing: boolean }
  | { type: 'volume'; level: number; muted: boolean }
  | { type: 'loaded'; trackId: string; title: string; artist: string; album: string; cover: string }
  | { type: 'ended' }
  | { type: 'error'; message: string }
  | { type: 'receiver-state'; state: ReceiverState }
  | { type: 'receiver-error'; code: string; message: string }
  | { type: 'receiver-log'; level: string; tag: string; message: string }
  | { type: 'connection'; status: 'live' | 'stale' | 'error'; reason?: string };

type Listener = (e: CastEvent) => void;

function absUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
}

interface PendingMessage {
  msg: CastMsg<unknown>;
  attempts: number;
  resolveFn: () => void;
  rejectFn: (err: Error) => void;
}

export class CastBridge {
  available = false;
  active = false;
  loaded = false;
  deviceName: string | null = null;
  volumeLevel = 1;
  muted = false;
  isPlaying = false;
  receiverState: ReceiverState | null = null;
  customChannelOpen = false;
  connectionStatus: 'live' | 'stale' | 'error' | 'idle' = 'idle';

  private listeners = new Set<Listener>();
  private remotePlayer: any = null;
  private remoteController: any = null;
  private queueAdvance: ((from: 'cast') => void) | null = null;
  private lastTrackId: string | null = null;
  private lastLoad: { trackId: string; title: string; artist: string; album: string; cover: string } | null =
    null;
  private session: any = null;
  private inboundLastAt = 0;
  private outboundQueue: PendingMessage[] = [];
  private senderTickTimer = 0;
  private staleWatchTimer = 0;
  // DEFAULT = custom branded receiver (228565CB). Brian confirmed it is PUBLISHED
  // in the Cast SDK Developer Console (2026-06-08), so it no longer filters the
  // picker — every Chromecast (incl. the Living Room TV) shows AND boots the
  // gorgeous branded TV UI. Users can opt out to the Default Media Receiver via
  // the "Branded TV UI" toggle.
  //
  // SAFETY NET: watchCastState() auto-reverts to RECEIVER_FALLBACK if the SDK
  // reports NO_DEVICES_AVAILABLE for >6s (the filtered-picker symptom) — so even
  // if the publication ever regresses, ordinary TVs reappear automatically rather
  // than vanishing (the 2026-06-08 incident where an assumed-published status hid
  // the Living Room TV). Flipping the default is reversible at runtime + per-user.
  private appId = CAST_APP_ID;
  private fallbackTried = false;
  // Auto-heal a filtered picker: an unpublished custom App ID makes the SDK
  // report NO_DEVICES_AVAILABLE even when ordinary Chromecasts ARE on the network
  // (they're filtered out of the picker). If that persists in custom mode we
  // revert to the Default Media Receiver so the TV reappears — see watchCastState.
  private filteredPickerTimer = 0;
  private pickerHealed = false;
  private get usesCustomReceiver(): boolean {
    return this.appId !== RECEIVER_FALLBACK;
  }

  /** Switch to the custom branded receiver. Only call after the device is known
   * to be bound to App ID 228565CB (e.g. dev devices, or after the user enables
   * "Branded TV UI" in settings). Re-applies cast options if framework is ready. */
  enableCustomReceiver(): void {
    if (this.appId === CAST_APP_ID) return;
    this.appId = CAST_APP_ID;
    this.fallbackTried = false;
    this.pickerHealed = false;
    const ctx = window.cast?.framework?.CastContext?.getInstance?.();
    if (ctx) this.applyOptions(ctx);
  }

  /** Revert to the Default Media Receiver (CC1AD845). Used when the user
   * toggles "Branded TV UI" off — frees future sessions to land on any Cast
   * device, even those not registered to App ID 228565CB. */
  disableCustomReceiver(): void {
    if (this.appId === RECEIVER_FALLBACK) return;
    this.appId = RECEIVER_FALLBACK;
    this.fallbackTried = false;
    const ctx = window.cast?.framework?.CastContext?.getInstance?.();
    if (ctx) this.applyOptions(ctx);
  }

  getReceiverMode(): 'custom' | 'default' {
    return this.usesCustomReceiver ? 'custom' : 'default';
  }

  init() {
    if (typeof window === 'undefined') return;
    if (this.loaded || document.querySelector('script[data-cast]')) return;
    this.loaded = true;
    window.__onGCastApiAvailable = (available: boolean) => {
      this.available = available;
      this.emit({ type: 'available', available });
      if (!available) return;
      const ctx = window.cast?.framework?.CastContext?.getInstance?.();
      if (!ctx) return;
      this.applyOptions(ctx);
      this.bindContextEvents(ctx);
      this.bindRemotePlayer();
    };
    const s = document.createElement('script');
    // Trusted Types: wrap the gstatic Cast SDK URL — the default policy
    // installed at boot already permits this, but explicit wrap avoids
    // the report-only TrustedScriptURL violation log.
    s.src = asScriptURL(CAST_FRAMEWORK_URL);
    s.async = true;
    s.dataset.cast = '1';
    s.onerror = () => this.emit({ type: 'error', message: 'cast framework script failed to load' });
    document.head.appendChild(s);
  }

  private applyOptions(ctx: any) {
    try {
      ctx.setOptions({
        receiverApplicationId: this.appId,
        autoJoinPolicy: window.chrome!.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        resumeSavedSession: true,
        androidReceiverCompatible: true
      });
    } catch (err: unknown) {
      this.emit({
        type: 'error',
        message: 'cast options failed: ' + (err instanceof Error ? err.message : String(err))
      });
    }
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setQueueAdvance(fn: (from: 'cast') => void) {
    this.queueAdvance = fn;
  }

  private emit(e: CastEvent) {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* swallow */
      }
    }
  }

  private setStatus(status: 'live' | 'stale' | 'error' | 'idle', reason?: string) {
    if (this.connectionStatus === status) return;
    this.connectionStatus = status;
    if (status !== 'idle') this.emit({ type: 'connection', status, reason });
  }

  private bindContextEvents(ctx: any) {
    const SessionEventType = window.cast.framework.CastContextEventType;
    this.watchCastState(ctx);
    ctx.addEventListener(SessionEventType.SESSION_STATE_CHANGED, (ev: any) => {
      const stateName = ev.sessionState as string;
      const session = ctx.getCurrentSession();
      const isActive = stateName === 'SESSION_STARTED' || stateName === 'SESSION_RESUMED';
      const isEnded = stateName === 'SESSION_ENDED' || stateName === 'NO_SESSION';
      if (isActive && session) {
        this.active = true;
        this.session = session;
        this.deviceName = session.getCastDevice()?.friendlyName ?? null;
        this.emit({ type: 'session', active: true, deviceName: this.deviceName ?? undefined });
        this.openCustomChannel(session);
        if (this.usesCustomReceiver) {
          this.startSenderTick();
          this.startStaleWatch();
        }
      } else if (isEnded) {
        this.active = false;
        this.session = null;
        this.lastTrackId = null;
        this.lastLoad = null;
        this.deviceName = null;
        this.receiverState = null;
        this.customChannelOpen = false;
        this.stopSenderTick();
        this.stopStaleWatch();
        this.setStatus('idle');
        this.emit({ type: 'session', active: false });
      }
    });
  }

  /** Auto-heal a filtered cast picker. In custom-receiver mode an unpublished
   * App ID (228565CB) makes the SDK report NO_DEVICES_AVAILABLE even when
   * ordinary Chromecasts are present — they're filtered out, so the user "loses"
   * their TV. If that state persists past a 6s grace (covers the SDK's device
   * discovery window), revert to the Default Media Receiver so every device
   * reappears in the picker. Runtime-only — never erases the saved preference,
   * so a genuinely-published receiver re-engages on the next load. */
  private watchCastState(ctx: any) {
    const EvType = window.cast.framework.CastContextEventType;
    if (!EvType?.CAST_STATE_CHANGED) return;
    ctx.addEventListener(EvType.CAST_STATE_CHANGED, (ev: any) => {
      const cs = String(ev?.castState ?? '');
      if (this.usesCustomReceiver && !this.pickerHealed && cs === 'NO_DEVICES_AVAILABLE') {
        if (!this.filteredPickerTimer) {
          this.filteredPickerTimer = window.setTimeout(() => {
            this.filteredPickerTimer = 0;
            const cur = String(ctx.getCastState?.() ?? '');
            if (this.usesCustomReceiver && !this.pickerHealed && cur === 'NO_DEVICES_AVAILABLE') {
              this.pickerHealed = true;
              this.appId = RECEIVER_FALLBACK;
              this.applyOptions(ctx);
              this.emit({
                type: 'error',
                message:
                  'No cast devices found with the branded receiver — switched to the default so your TV reappears.'
              });
            }
          }, 6000);
        }
      } else if (this.filteredPickerTimer && cs !== 'NO_DEVICES_AVAILABLE') {
        clearTimeout(this.filteredPickerTimer);
        this.filteredPickerTimer = 0;
      }
    });
  }

  private bindRemotePlayer() {
    if (!window.cast?.framework?.RemotePlayer) return;
    this.remotePlayer = new window.cast.framework.RemotePlayer();
    this.remoteController = new window.cast.framework.RemotePlayerController(this.remotePlayer);
    const E = window.cast.framework.RemotePlayerEventType;
    this.remoteController.addEventListener(E.IS_PAUSED_CHANGED, () => {
      this.isPlaying = !this.remotePlayer.isPaused;
      this.emit({ type: 'state', playing: this.isPlaying });
    });
    this.remoteController.addEventListener(E.CURRENT_TIME_CHANGED, () => {
      this.emit({
        type: 'progress',
        currentTime: this.remotePlayer.currentTime ?? 0,
        duration: this.remotePlayer.duration ?? 0
      });
    });
    this.remoteController.addEventListener(E.DURATION_CHANGED, () => {
      this.emit({
        type: 'progress',
        currentTime: this.remotePlayer.currentTime ?? 0,
        duration: this.remotePlayer.duration ?? 0
      });
    });
    this.remoteController.addEventListener(E.VOLUME_LEVEL_CHANGED, () => {
      this.volumeLevel = this.remotePlayer.volumeLevel ?? 1;
      this.muted = !!this.remotePlayer.isMuted;
      this.emit({ type: 'volume', level: this.volumeLevel, muted: this.muted });
    });
    this.remoteController.addEventListener(E.PLAYER_STATE_CHANGED, () => {
      const state = this.remotePlayer.playerState as string | undefined;
      if (state === 'IDLE') {
        const session = window.cast.framework.CastContext.getInstance().getCurrentSession();
        const media = session?.getMediaSession?.();
        const reason = media?.idleReason as string | undefined;
        if (reason === 'FINISHED') {
          this.emit({ type: 'ended' });
          if (this.queueAdvance) this.queueAdvance('cast');
        }
      }
    });
  }

  // ─── Custom message channel ────────────────────────────────────────────
  private openCustomChannel(session: any) {
    // Default Media Receiver doesn't subscribe to our namespace; sender drives
    // playback via session.loadMedia() instead. Skip channel + heartbeats so
    // outbound queue messages aren't silently dropped.
    if (!this.usesCustomReceiver) {
      this.customChannelOpen = false;
      this.outboundQueue.length = 0;
      this.setStatus('live');
      return;
    }
    try {
      session.addMessageListener(CAST_NAMESPACE, (_ns: string, raw: string) => {
        this.inboundLastAt = Date.now();
        let msg: unknown;
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        if (!isCastMsg(msg)) return;
        this.handleReceiverMessage(msg);
      });
      this.customChannelOpen = true;
      this.flushOutbound(); // any messages queued before session resume
      this.sendCustom('hello', { senderId: 'web', appVersion: APP_VERSION } as HelloPayload);
      this.sendCustom('state:request', null);
      this.setStatus('live');
    } catch (err: unknown) {
      this.customChannelOpen = false;
      const msg = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', message: 'custom channel open failed: ' + msg });
      this.tryFallbackReceiver();
    }
  }

  private handleReceiverMessage(msg: CastMsg<unknown>) {
    switch (msg.type) {
      case 'state:full':
      case 'state:tick': {
        const state = msg.payload as ReceiverState | undefined;
        if (state) {
          this.receiverState = state;
          this.emit({ type: 'receiver-state', state });
          this.setStatus('live');
        }
        break;
      }
      case 'state:error': {
        const p = msg.payload as ErrorPayload | undefined;
        if (p) this.emit({ type: 'receiver-error', code: p.code, message: p.message });
        break;
      }
      case 'log': {
        const p = msg.payload as LogPayload | undefined;
        if (p) this.emit({ type: 'receiver-log', level: p.level, tag: p.tag, message: p.message });
        break;
      }
      case 'pong':
        /* heartbeat acknowledged */ break;
    }
  }

  /** Send any custom message to the receiver, with retry queueing if the
   * channel isn't open yet (e.g. first call before SESSION_STARTED fires). */
  sendCustom(type: CastMsg['type'], payload?: unknown): Promise<void> {
    return new Promise((resolveFn, rejectFn) => {
      const msg = packMsg(type, payload);
      const item: PendingMessage = { msg, attempts: 0, resolveFn, rejectFn };
      this.outboundQueue.push(item);
      this.flushOutbound();
    });
  }

  private flushOutbound() {
    if (!this.session || !this.customChannelOpen) return;
    const queue = this.outboundQueue;
    this.outboundQueue = [];
    for (const item of queue) {
      try {
        this.session.sendMessage(CAST_NAMESPACE, JSON.stringify(item.msg));
        item.resolveFn();
      } catch (err: unknown) {
        item.attempts += 1;
        if (item.attempts < 3) {
          this.outboundQueue.push(item);
          setTimeout(() => this.flushOutbound(), 250 * item.attempts);
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          item.rejectFn(new Error('sendMessage exhausted retries: ' + msg));
          this.emit({ type: 'error', message: 'cast send failed: ' + msg });
        }
      }
    }
  }

  private startSenderTick() {
    this.stopSenderTick();
    const period = Math.round(1000 / SENDER_TICK_HZ);
    this.senderTickTimer = window.setInterval(() => {
      if (!this.active) return;
      this.sendCustom('ping', { ts: Date.now() }).catch(() => {
        /* tick failure surfaced via error event */
      });
    }, period);
  }
  private stopSenderTick() {
    if (this.senderTickTimer) {
      clearInterval(this.senderTickTimer);
      this.senderTickTimer = 0;
    }
  }

  private startStaleWatch() {
    this.stopStaleWatch();
    this.staleWatchTimer = window.setInterval(() => {
      if (!this.active || !this.customChannelOpen) return;
      const silent = Date.now() - this.inboundLastAt;
      if (silent > STALE_MS) {
        this.setStatus('stale', `no inbound for ${Math.round(silent / 1000)}s`);
        this.sendCustom('state:request', null).catch(() => {
          /* swallow */
        });
      } else if (silent < 2500) {
        this.setStatus('live');
      }
    }, 2000);
  }
  private stopStaleWatch() {
    if (this.staleWatchTimer) {
      clearInterval(this.staleWatchTimer);
      this.staleWatchTimer = 0;
    }
  }

  /** If custom App ID load fails (unregistered receiver crashes immediately),
   * retry once with the default media receiver so audio still plays. Custom UI
   * is lost in fallback mode but the user can still listen. */
  private tryFallbackReceiver() {
    if (this.fallbackTried || this.appId === RECEIVER_FALLBACK) return;
    this.fallbackTried = true;
    this.appId = RECEIVER_FALLBACK;
    const ctx = window.cast?.framework?.CastContext?.getInstance?.();
    if (ctx) this.applyOptions(ctx);
    this.emit({ type: 'error', message: 'custom receiver unavailable — using default media receiver' });
  }

  // ─── Public queue API ──────────────────────────────────────────────────
  loadQueue(items: ReceiverQueueItem[], opts: Partial<QueueLoadPayload> = {}): Promise<void> {
    return this.sendCustom('queue:load', {
      items,
      startIndex: opts.startIndex ?? 0,
      startPosition: opts.startPosition ?? 0,
      autoplay: opts.autoplay ?? true,
      shuffle: opts.shuffle,
      loop: opts.loop
    } as QueueLoadPayload);
  }

  insertItems(items: ReceiverQueueItem[], afterId?: string): Promise<void> {
    return this.sendCustom('queue:insert', { items, afterId } as InsertPayload);
  }

  removeItem(id: string): Promise<void> {
    return this.sendCustom('queue:remove', { id } as RemovePayload);
  }

  reorderItem(id: string, toIndex: number): Promise<void> {
    return this.sendCustom('queue:reorder', { id, toIndex } as ReorderPayload);
  }

  selectItem(id: string, position?: number): Promise<void> {
    return this.sendCustom('queue:select', { id, position } as SelectPayload);
  }

  setView(view: ViewPayload['view']): Promise<void> {
    return this.sendCustom('view:set', { view } as ViewPayload);
  }

  setPalette(p: PalettePayload): Promise<void> {
    return this.sendCustom('palette:set', p);
  }

  setLyrics(trackId: string, lines: ReceiverLine[]): Promise<void> {
    return this.sendCustom('lyrics:set', { trackId, lines } as LyricsPayload);
  }

  // ─── Standard CAF media (still used as fallback / single-track casts) ─
  async loadTrack(track: Track, coverPath: string, albumName: string, startSeconds = 0): Promise<void> {
    if (!this.active) throw new Error('cast session not active');
    const session = window.cast.framework.CastContext.getInstance().getCurrentSession();
    if (!session) throw new Error('no cast session');
    const file = absUrl(track.file);
    const cover = absUrl(coverPath);
    const mediaInfo = new window.chrome!.cast.media.MediaInfo(file, 'audio/mpeg');
    mediaInfo.metadata = new window.chrome!.cast.media.MusicTrackMediaMetadata();
    mediaInfo.metadata.title = track.title;
    mediaInfo.metadata.artist = track.artist;
    mediaInfo.metadata.albumName = albumName;
    mediaInfo.metadata.images = [{ url: cover }];
    mediaInfo.customData = { trackId: track.id };
    const request = new window.chrome!.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;
    request.currentTime = Math.max(0, startSeconds);
    try {
      await session.loadMedia(request);
      this.lastTrackId = track.id;
      this.lastLoad = {
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        album: albumName,
        cover
      };
      this.emit({ type: 'loaded', ...this.lastLoad });
    } catch (err: unknown) {
      this.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  currentLoad() {
    return this.lastLoad;
  }

  toggleMute() {
    if (!this.active) return;
    if (this.customChannelOpen) {
      this.sendCustom('transport:mute', { muted: !this.muted } as MutePayload).catch(() =>
        this.remoteController?.muteOrUnmute()
      );
    } else {
      this.remoteController?.muteOrUnmute();
    }
  }

  async requestSession(): Promise<void> {
    if (!this.available) throw new Error('cast not available');
    const ctx = window.cast.framework.CastContext.getInstance();
    try {
      await ctx.requestSession();
    } catch (err: unknown) {
      const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : 'cast cancelled';
      if (msg === 'cancel') return;
      // select_unknown_id (905) = receiver app not registered to the picked
      // device. Fall back to default media receiver and retry once so the user
      // doesn't see a silent failure.
      const isUnknownAppId = /select_unknown_id|unknown.*receiver|905/i.test(msg);
      if (isUnknownAppId && this.usesCustomReceiver) {
        this.tryFallbackReceiver();
        try {
          await ctx.requestSession();
          return;
        } catch (err2: unknown) {
          const msg2 =
            typeof err2 === 'string' ? err2 : err2 instanceof Error ? err2.message : 'cast cancelled';
          if (msg2 === 'cancel') return;
          this.emit({ type: 'error', message: msg2 });
          return;
        }
      }
      this.emit({ type: 'error', message: msg });
    }
  }

  togglePlayPause() {
    if (!this.active) return;
    if (this.customChannelOpen) {
      const next = this.isPlaying ? 'transport:pause' : 'transport:play';
      this.sendCustom(next).catch(() => this.remoteController?.playOrPause());
    } else {
      this.remoteController?.playOrPause();
    }
  }

  seek(seconds: number) {
    if (!this.active) return;
    const pos = Math.max(0, seconds);
    if (this.customChannelOpen) {
      this.sendCustom('transport:seek', { position: pos } as SeekPayload).catch(() => {
        if (this.remotePlayer) {
          this.remotePlayer.currentTime = pos;
          this.remoteController?.seek();
        }
      });
    } else if (this.remotePlayer) {
      this.remotePlayer.currentTime = pos;
      this.remoteController?.seek();
    }
  }

  private volumeRampFrame = 0;

  setVolume(level: number, opts: { ramp?: boolean; durationMs?: number } = {}) {
    if (!this.active) return;
    const lvl = Math.max(0, Math.min(1, level));
    if (this.customChannelOpen) {
      this.sendCustom('transport:volume', { level: lvl } as VolumePayload).catch(() => {
        this.applyVolumeFallback(lvl, opts.ramp ?? true, opts.durationMs ?? 260);
      });
      return;
    }
    this.applyVolumeFallback(lvl, opts.ramp ?? true, opts.durationMs ?? 260);
  }

  /** Ramp the remoteController volume over `duration` ms so receivers that
   * lack the custom channel (Default Media Receiver, third-party speakers)
   * don't jolt the listener with a step change when the slider is dragged. */
  private applyVolumeFallback(target: number, ramp: boolean, duration: number) {
    if (!this.remotePlayer || !this.remoteController) return;
    if (this.volumeRampFrame) {
      cancelAnimationFrame(this.volumeRampFrame);
      this.volumeRampFrame = 0;
    }
    const start =
      typeof this.remotePlayer.volumeLevel === 'number' ? this.remotePlayer.volumeLevel : this.volumeLevel;
    if (!ramp || Math.abs(target - start) < 0.02 || duration <= 0) {
      this.remotePlayer.volumeLevel = target;
      try {
        this.remoteController.setVolumeLevel();
      } catch {
        /* swallow */
      }
      this.volumeLevel = target;
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / duration);
      const eased = k * (2 - k); // easeOutQuad — quick, no overshoot
      const v = start + (target - start) * eased;
      try {
        this.remotePlayer.volumeLevel = v;
        this.remoteController.setVolumeLevel();
      } catch {
        /* receiver may have ended mid-ramp */
      }
      this.volumeLevel = v;
      if (k < 1 && this.active) {
        this.volumeRampFrame = requestAnimationFrame(step);
      } else {
        this.volumeRampFrame = 0;
      }
    };
    this.volumeRampFrame = requestAnimationFrame(step);
  }

  next(): Promise<void> {
    return this.sendCustom('transport:next');
  }
  prev(): Promise<void> {
    return this.sendCustom('transport:prev');
  }

  endSession(stopReceiver = true) {
    if (!this.active) return;
    const ctx = window.cast?.framework?.CastContext?.getInstance?.();
    ctx?.endCurrentSession(stopReceiver);
  }

  currentTrackId(): string | null {
    // Prefer the receiver's authoritative state when available
    return this.receiverState?.trackId ?? this.lastTrackId;
  }
}

export const cast = new CastBridge();
