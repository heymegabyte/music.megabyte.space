// Wire protocol shared between sender (website) and receiver (custom Cast app).
// Single source of truth for the namespace, App ID, message shapes, and
// transport semantics. Both sides import from here so a typo can't cause silent
// drops.
//
// Custom receiver (228565CB) is the primary path: navigable queue, synced
// lyrics, live visualizer, branded 10-foot UI at /cast-receiver/. Device
// CEZI7RBCIPI2HUBIW4NS is "Ready for Testing" in Cast Console as of
// 2026-05-11. RECEIVER_FALLBACK (Default Media Receiver) auto-engages via
// tryFallbackReceiver() if the custom App ID fails to load mid-session.

export const CAST_NAMESPACE = 'urn:x-cast:com.megabyte.music';
export const CAST_APP_ID = '228565CB'; // custom receiver — branded TV UI
export const CAST_CUSTOM_APP_ID = '228565CB';
export const RECEIVER_FALLBACK = 'CC1AD845'; // Default Media Receiver fallback
export const PROTOCOL_VERSION = 1;
export const TICK_HZ = 1; // receiver→senders heartbeat
export const SENDER_TICK_HZ = 0.5; // sender→receiver liveness
export const STALE_MS = 6000; // no tick in this window → request full state
export const MAX_QUEUE = 200;

export type CastMsgType =
  | 'hello'           // sender→receiver: handshake on session start
  | 'queue:load'      // sender→receiver: replace queue, optionally start playing
  | 'queue:insert'    // sender→receiver: append items
  | 'queue:remove'    // sender→receiver: remove by id
  | 'queue:reorder'   // sender→receiver: move by id
  | 'queue:select'    // sender→receiver: jump to track id
  | 'transport:play'
  | 'transport:pause'
  | 'transport:seek'
  | 'transport:next'
  | 'transport:prev'
  | 'transport:volume'
  | 'transport:mute'
  | 'view:set'        // sender→receiver: focus a UI surface
  | 'palette:set'     // sender→receiver: palette colors
  | 'lyrics:set'      // sender→receiver: synced lyrics for current track
  | 'state:request'   // sender→receiver: send full state now
  | 'state:full'      // receiver→sender: snapshot
  | 'state:tick'      // receiver→sender: lightweight tick
  | 'state:error'     // receiver→sender: surfaced error
  | 'ping'
  | 'pong'
  | 'log';            // either side: forward console events for diagnostics

export interface CastMsg<T = unknown> {
  v: number;        // PROTOCOL_VERSION
  type: CastMsgType;
  seq: number;      // monotonic per-sender
  ts: number;       // ms since epoch
  payload?: T;
}

export interface ReceiverQueueItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  audio: string;
  duration?: number;
  vibe?: string;
  bpm?: number;        // authoritative tempo from Suno provenance (rounded)
  musicalKey?: string; // e.g. "C minor" — Suno-detected key
}

export interface ReceiverWord { w: string; s: number; e: number; }
export interface ReceiverLine { t: number; text: string; e?: number; words?: ReceiverWord[]; }

export type ReceiverView = 'now-playing' | 'queue' | 'settings';

export interface ReceiverState {
  v: number;
  queue: ReceiverQueueItem[];
  index: number;
  trackId: string | null;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  view: ReceiverView;
  focusedIndex: number;
  shuffle: boolean;
  loop: 'off' | 'one' | 'all';
  ts: number;
  protocol: number;
}

export interface QueueLoadPayload {
  items: ReceiverQueueItem[];
  startIndex?: number;
  startPosition?: number;
  autoplay?: boolean;
  shuffle?: boolean;
  loop?: 'off' | 'one' | 'all';
}

export interface SeekPayload { position: number; }
export interface VolumePayload { level: number; }
export interface MutePayload { muted: boolean; }
export interface SelectPayload { id: string; position?: number; }
export interface InsertPayload { items: ReceiverQueueItem[]; afterId?: string; }
export interface RemovePayload { id: string; }
export interface ReorderPayload { id: string; toIndex: number; }
export interface ViewPayload { view: ReceiverView; }
export interface PalettePayload {
  bg: string;
  ink: string;
  accent: string;
  vibrant: string;
  muted: string;
  swatches: string[];
}
export interface LyricsPayload { trackId: string; lines: ReceiverLine[]; }
export interface ErrorPayload { code: string; message: string; recoverable: boolean; }
export interface LogPayload { level: 'info' | 'warn' | 'error'; tag: string; message: string; data?: unknown; }
export interface HelloPayload { senderId: string; appVersion: string; }

/** Monotonic per-process sequence counter for {@link packMsg}. */
export const newSeq = (() => { let n = 0; return () => ++n; })();

/**
 * Build a versioned, sequenced, timestamped Cast message. Always use this
 * (never construct a `CastMsg` literal at a call site) so the protocol
 * version and seq number stay in lockstep on both ends.
 */
export function packMsg<T>(type: CastMsgType, payload?: T): CastMsg<T> {
  return { v: PROTOCOL_VERSION, type, seq: newSeq(), ts: Date.now(), payload };
}

/**
 * Runtime validator for messages arriving over the Cast channel. The remote
 * side is trusted (same project) but a stale receiver can ship malformed
 * frames during a deploy gap — guard before reading.
 */
export function isCastMsg(x: unknown): x is CastMsg<unknown> {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return typeof m.type === 'string' && typeof m.seq === 'number' && typeof m.ts === 'number' && typeof m.v === 'number';
}
