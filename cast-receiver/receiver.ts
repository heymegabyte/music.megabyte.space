// CAF v3 receiver runtime — music.megabyte.space custom receiver (App ID 228565CB).
//
// Lifecycle:
//   1. /cast-receiver/index.html loads cast_receiver_framework.js (gstatic).
//   2. UA sniff (`CrKey/` marker) decides REAL vs STANDALONE preview.

// Default Trusted Types policy installed by inline <head> script in cast-receiver/index.html.
//      • REAL Chromecast → wire `CastReceiverContext.getPlayerManager()`,
//        open the custom namespace `urn:x-cast:com.megabyte.music`, then
//        `ctx.start()` with our tuned `PlaybackConfig`.
//      • STANDALONE (any other browser, Playwright, devtools) → swap
//        playerManager for a tiny HTMLAudioElement shim and expose
//        `window.__castReceiver` so the runtime is fully testable without
//        a physical Cast device.
//   3. `init()` boots the D-pad UI, visualizer, tick loop, and stale watcher.
//
// Error policy:
//   • Any thrown exception in handleSenderMessage / dispatch is caught and
//     surfaced via `errorOut()` (toast + state:error + status indicator).
//   • Playback errors trigger exponential backoff (3 retries @ 1/3/9s),
//     then skip the bad track so the queue never wedges.
//   • Asset 404 (cover image) silently swaps to a brand fallback.
//   • SDK load failure shows a full-screen "Receiver fatal" panel (REAL mode
//     only — preview mode tolerates missing SDK).
//
// Standalone preview contract (used by tests/cast.spec.ts):
//   window.__castReceiver = {
//     standalone: true,
//     runtime,                          // mutable state — read-only in tests
//     audio: HTMLAudioElement | null,
//     loadQueue(items, startIndex?),
//     play(), pause(), seek(seconds),
//     current(): ReceiverQueueItem | null,
//     state(): { playing, position, duration, trackId }
//   }

import {
  CAST_NAMESPACE, PROTOCOL_VERSION, TICK_HZ,
  type CastMsg, type ReceiverState, type ReceiverQueueItem, type ReceiverLine,
  type ReceiverView, type QueueLoadPayload, type SeekPayload, type VolumePayload,
  type MutePayload, type SelectPayload, type InsertPayload, type RemovePayload,
  type ReorderPayload, type ViewPayload, type PalettePayload, type LyricsPayload,
  type LogPayload, type HelloPayload,
  isCastMsg, packMsg
} from '../src/cast-protocol';
import { TRACKS, ALBUMS } from '../src/data';

interface StandaloneApi {
  standalone: true;
  runtime: RuntimeState;
  audio: HTMLAudioElement | null;
  loadQueue: (items: ReceiverQueueItem[], startIndex?: number) => void;
  setLyrics: (trackId: string, lines: ReceiverLine[]) => void;
  play: () => void;
  pause: () => void;
  seek: (s: number) => void;
  current: () => ReceiverQueueItem | null;
  state: () => { playing: boolean; position: number; duration: number; trackId: string | null };
}

declare global {
  interface Window {
    cast?: any;
    __castReceiver?: StandaloneApi;
  }
}

interface RuntimeState {
  queue: ReceiverQueueItem[];
  index: number;
  focusedIndex: number;
  view: ReceiverView;
  lyrics: ReceiverLine[];
  lyricsTrackId: string | null;
  shuffle: boolean;
  loop: 'off' | 'one' | 'all';
}

const runtime: RuntimeState = {
  queue: [],
  index: -1,
  focusedIndex: -1,
  view: 'now-playing',
  lyrics: [],
  lyricsTrackId: null,
  shuffle: false,
  loop: 'all'
};

let lastSenderHelloAt = 0;
let lastBroadcastAt = 0;
let pendingState = false;
let outboundSeq = 0;
let activeError: string | null = null;
let lastLyricsActiveIdx = -2;
let lastLyricsActiveWordIdx = -2;

// Standalone preview: when loaded directly (not via Chromecast) ctx.start()
// never assigns an internal sender channel, so sendCustomMessage throws on
// every call. Detect that mode via getSenders()===0 and route playback
// through a native <audio> element so the page is still demoable + testable.
let standaloneMode = false;
let standaloneAudio: HTMLAudioElement | null = null;
// Browser autoplay policy rejects play() until the user has interacted with
// the page. That's a needs-gesture state, NOT a playback error — surface a
// hint + attempt resume on the next click instead of logging + retrying.
let pendingAutoplayResume = false;
// Defer AudioContext creation until audio is genuinely allowed to play (a user
// gesture in preview, or PLAYING state in a real Cast session). Creating it
// eagerly trips Chrome's "AudioContext was not allowed to start" console warning
// in the ?test preview. Until unlocked, the visualizer draws a synthetic wave.
let audioUnlocked = false;

// Playback failure backoff: per-track strike count, then skip after 3 strikes
// so the playlist never wedges on one bad object.
let failCount = 0;
let failTrackId: string | null = null;
let recoverTimer = 0;
const BACKOFF_MS = [1000, 3000, 9000];
function clearRecoverTimer() {
  if (recoverTimer) { clearTimeout(recoverTimer); recoverTimer = 0; }
}

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const $$ = <T extends Element = HTMLElement>(s: string) => Array.from(document.querySelectorAll(s)) as T[];

// ─── CAF setup ──────────────────────────────────────────────────────────────
// Real Chromecasts ship `CrKey/<version>` in the UA. Any other UA = the page
// is loaded for preview/QA — switch to a standalone audio element so the
// receiver can be exercised in a normal browser tab.
standaloneMode = !/CrKey\//i.test(navigator.userAgent);

// Fail-loud BEFORE accessing window.cast.framework so a gstatic load failure
// (CSP, network, geo-block) surfaces as a visible "Receiver fatal: ..." panel
// on the TV instead of a silent module crash that leaves the screen blank.
// In standalone preview mode the SDK is optional — skip the throw so the
// page can still demo without gstatic.
if (typeof window.cast?.framework?.CastReceiverContext !== 'function') {
  if (!standaloneMode) {
    showFatal('CAF receiver SDK missing — cast_receiver_framework.js failed to load');
    throw new Error('CAF receiver SDK missing');
  }
}

const ctx: any = window.cast?.framework?.CastReceiverContext?.getInstance?.() ?? null;
const playerManager: any = standaloneMode ? buildStandalonePlayer() : ctx.getPlayerManager();
const Events = window.cast?.framework?.events?.EventType ?? {};

function buildStandalonePlayer() {
  standaloneAudio = new Audio();
  standaloneAudio.crossOrigin = 'anonymous';
  standaloneAudio.preload = 'auto';
  // Append to DOM so document.querySelector('audio') in test/devtools finds it
  // AND so the browser actually fetches the src (detached audio elements can
  // load metadata but their lifecycle is fragile across some Chromium versions).
  standaloneAudio.setAttribute('data-standalone-receiver', 'true');
  standaloneAudio.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
  const attach = () => document.body?.appendChild(standaloneAudio!);
  if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach, { once: true });
  const listeners: Record<string, Array<() => void>> = {};
  const fire = (k: string) => (listeners[k] ?? []).forEach((fn) => { try { fn(); } catch { /* swallow */ } });
  standaloneAudio.addEventListener('playing', () => fire('PLAYING'));
  standaloneAudio.addEventListener('pause', () => fire('PAUSE'));
  standaloneAudio.addEventListener('seeked', () => fire('SEEKED'));
  standaloneAudio.addEventListener('timeupdate', () => fire('TIME_UPDATE'));
  standaloneAudio.addEventListener('loadstart', () => fire('LOAD_START'));
  standaloneAudio.addEventListener('loadeddata', () => fire('LOADED_DATA'));
  standaloneAudio.addEventListener('ended', () => fire('MEDIA_FINISHED'));
  standaloneAudio.addEventListener('error', () => fire('ERROR'));
  // Buffering / stall → show the overlay; resume → hide it.
  standaloneAudio.addEventListener('waiting', () => setBuffering(true));
  standaloneAudio.addEventListener('stalled', () => setBuffering(true));
  standaloneAudio.addEventListener('playing', () => setBuffering(false));
  standaloneAudio.addEventListener('canplay', () => setBuffering(false));
  standaloneAudio.addEventListener('seeked', () => setBuffering(false));
  return {
    addEventListener: (k: string, fn: () => void) => { (listeners[k] ??= []).push(fn); },
    setMessageInterceptor: (_t: any, _fn: any) => { /* no-op in standalone */ },
    load: (req: any) => {
      const url = req?.media?.contentId;
      if (typeof url === 'string' && standaloneAudio) {
        standaloneAudio.src = url;
        const cur = Math.max(0, req?.currentTime ?? 0);
        if (cur) standaloneAudio.currentTime = cur;
        if (req?.autoplay !== false) {
          standaloneAudio.play().catch((err: any) => {
            if (err && (err.name === 'NotAllowedError' || /user (?:didn'?t|did not) interact|gesture/i.test(err.message ?? ''))) {
              pendingAutoplayResume = true;
              toast('Tap to start playback', 'live', 4000);
              return;
            }
            fire('ERROR');
          });
        }
      }
    },
    play: () => standaloneAudio?.play().catch((err: any) => {
      if (err?.name === 'NotAllowedError') pendingAutoplayResume = true;
    }),
    pause: () => standaloneAudio?.pause(),
    stop: () => { if (standaloneAudio) { standaloneAudio.pause(); standaloneAudio.currentTime = 0; } },
    seek: (s: number) => { if (standaloneAudio) standaloneAudio.currentTime = Math.max(0, s); },
    setVolume: (v: number) => { if (standaloneAudio) standaloneAudio.volume = Math.max(0, Math.min(1, v)); },
    getCurrentTimeSec: () => standaloneAudio?.currentTime ?? 0,
    getDurationSec: () => (Number.isFinite(standaloneAudio?.duration ?? NaN) ? standaloneAudio!.duration : 0),
    getPlayerState: () => standaloneAudio && !standaloneAudio.paused ? 'PLAYING' : 'PAUSED',
    getCurrentVolume: () => ({ level: standaloneAudio?.volume ?? 1, muted: !!standaloneAudio?.muted }),
    getMediaInformation: () => null
  };
}

// Open custom message channel (fail loud — without this, no sync)
if (!standaloneMode) {
  ctx.addCustomMessageListener(CAST_NAMESPACE, handleSenderMessage);

  // LOAD interceptor — when senders push individual tracks via standard CAF load,
  // merge them into the queue so single-track casts still appear in our list.
  playerManager.setMessageInterceptor(
    window.cast!.framework.messages.MessageType.LOAD,
    (req: any) => {
      try {
        const m = req.media;
        if (m?.contentId) {
          const item: ReceiverQueueItem = {
            id: m.customData?.trackId ?? hashId(m.contentId),
            title: m.metadata?.title ?? 'Unknown',
            artist: m.metadata?.artist ?? '',
            album: m.metadata?.albumName ?? '',
            cover: m.metadata?.images?.[0]?.url ?? '',
            audio: m.contentId,
            duration: m.duration ?? undefined
          };
          upsertCurrent(item);
        }
      } catch (err) {
        logErr('load-intercept', err);
      }
      return req;
    }
  );
}

// PLAY/PAUSE/SEEK/MEDIA_STATUS — broadcast on any change
const subscribe = (type: string | undefined, fn: () => void) => {
  if (!type) return;
  try { playerManager.addEventListener(type, fn); }
  catch (err) { logErr('subscribe:' + type, err); }
};
subscribe(Events.PLAYING, () => { audioUnlocked = true; renderUI(); broadcast(); });
subscribe(Events.PAUSE, () => { renderUI(); broadcast(); });
subscribe(Events.SEEKED, () => broadcast());
subscribe(Events.TIME_UPDATE, () => updateProgress());
subscribe(Events.LOAD_START, () => setStatus('live', 'Loading…'));
subscribe(Events.LOADED_DATA, () => {
  failCount = 0;
  failTrackId = null;
  clearRecoverTimer();
  setStatus('live', 'Live');
  broadcast();
});
subscribe(Events.MEDIA_FINISHED, () => onTrackEnded());
subscribe(Events.ERROR, (e: any) => onPlaybackError(e));
// CAF buffering state (real Chromecast) → buffering overlay.
subscribe(Events.BUFFERING, (e: any) => setBuffering(e?.isBuffering === true));

if (!standaloneMode) {
  ctx.addEventListener(window.cast!.framework.system.EventType?.SENDER_CONNECTED ?? 'senderconnected', (ev: any) => {
    toast(`Sender connected · ${ev?.senderId ?? 'unknown'}`, 'success', 1800);
    setStatus('live', 'Live');
    broadcast(true);
  });
  ctx.addEventListener(window.cast!.framework.system.EventType?.SENDER_DISCONNECTED ?? 'senderdisconnected', () => {
    setStatus('stale', 'Sender disconnected');
  });
}

// SDK is guaranteed ready (early throw above). Configure playback + start.
// Standalone mode skips ctx.start() entirely — the HTMLAudioElement shim is
// self-sufficient and ctx.start() would just produce harmless no-ops anyway.
if (!standaloneMode) {
  // CAF v3 wraps Shaka Player. Defaults give a single best-effort load and a
  // generic LOAD_FAILED on any hiccup. Override with explicit retry, longer
  // network timeouts, and a manifestRequestHandler that scrubs/normalises the
  // outbound media URL so flaky CDN edges + transient cold-cache R2 reads
  // don't surface to the user as detailedErrorCode 905.
  const playbackConfig = new window.cast!.framework.PlaybackConfig();
  playbackConfig.autoResumeNumberOfSegments = 4;
  playbackConfig.autoResumeDuration = 2;
  playbackConfig.initialBandwidth = 384000;
  playbackConfig.licenseRequestRetryParams = { maxRetries: 4, baseDelay: 800, maxDelay: 8000, backoffFactor: 2, fuzzFactor: 0.4, timeout: 15000 };
  playbackConfig.manifestRequestRetryParams = { maxRetries: 4, baseDelay: 800, maxDelay: 8000, backoffFactor: 2, fuzzFactor: 0.4, timeout: 15000 };
  playbackConfig.segmentRequestRetryParams = { maxRetries: 6, baseDelay: 600, maxDelay: 10000, backoffFactor: 2, fuzzFactor: 0.4, timeout: 20000 };
  // Receiver fetches media with CORS mode; this hook lets us add hints + force
  // absolute https URLs even if sender mistakenly forwarded a relative one.
  playbackConfig.manifestRequestHandler = (req: any) => {
    try {
      if (typeof req.url === 'string') {
        if (req.url.startsWith('//')) req.url = 'https:' + req.url;
        else if (req.url.startsWith('/')) req.url = 'https://music.megabyte.space' + req.url;
      }
      req.withCredentials = false;
    } catch { /* swallow */ }
  };
  playbackConfig.segmentRequestHandler = (req: any) => {
    try { req.withCredentials = false; } catch { /* swallow */ }
  };
  ctx.start({
    statusText: 'Ready',
    customNamespaces: { [CAST_NAMESPACE]: window.cast!.framework.system.MessageType.JSON },
    playbackConfig,
    // disable idle screensaver so the visualizer is never replaced by a logo
    disableIdleTimeout: true,
    skipMplLoad: false,
    // Larger queue cache for gapless skips
    queueRequestHandler: undefined
  });
}

// Visualizer module state — MUST be declared before init() (which calls
// startVisualizer()) since `let` is not hoisted: reading it earlier throws a
// TDZ ReferenceError that blanks the whole receiver.
//   beatEnergy — smoothed bass level (0..1) pushed into the --beat CSS var so
//                the album-glow ring + aurora pulse without a 2nd JS loop.
//   vizQuality — 'high' until the FPS probe downshifts to 'lite' on weak TV GPUs
//                (fewer bars, no particles/reflection/blur, DPR=1).
let beatEnergy = 0;
let vizQuality: 'high' | 'lite' = 'high';
// Lyrics + meta fetch state — declared BEFORE init() so the boot-time auto-seed
// (init → onQueueLoad → primeLyrics → selfFetchLyrics/enrichMeta) never hits a
// temporal-dead-zone on these module-level lets.
let lyricsFetchToken = 0;
let castMetaPromise: Promise<Record<string, { bpm?: number; key?: string }>> | null = null;
// Lyrics source for the CURRENT track. Self-fetched lyrics (/lyrics/<id>.json)
// are authoritative — their word timings match the exact MP3 the receiver
// streams — so a self-fetch always wins and a sender push only fills the gap
// when there's no JSON file. Reset to null on every track change.
let lyricsSource: 'self' | 'sender' | null = null;
// Set true once self-fetch confirms a track has NO lyrics file (404/empty) so
// renderLyrics shows a gorgeous "instrumental" state instead of a perpetual
// "Lyrics syncing…" (which falsely implies lyrics are still loading). Reset per
// track in primeLyrics; cleared the moment real lyrics arrive (sender or self).
let lyricsMissing = false;
// Cached lyric DOM (rebuilt in renderLyrics) so the 60fps tick never re-queries
// the document — keeps karaoke word-fill cheap on weak Android TVs.
let lyricLineEls: HTMLElement[] = [];
let activeWordEls: HTMLSpanElement[] = [];
// Per-track palette extracted from the cover art (receiver-side) — gives every
// track its own accent without a sender push. Sender palette:set still wins.
let paletteFromSender = false;
let lastPaletteTrackId: string | null = null;
const paletteCache = new Map<string, { accent: string; accent2: string; violet: string }>();
// UI-awake timer — declared before init() so wakeUI() is safe to call from the
// boot-time auto-seed (track load wakes the UI before it auto-dims).
let uiAwakeTimer = 0;
// Buffering overlay debounce — declared before init() (standalone player wires
// 'waiting' listeners during boot).
let bufferTimer = 0;
// Up Next card state — declared before init() (loadAndPlay → hideUpNext runs
// during the boot-time auto-seed).
let upNextShownFor: string | null = null;

init();

// ─── Init UI ────────────────────────────────────────────────────────────────
function init() {
  setView('idle');
  setupKeyboard();
  startVisualizer();
  startTickLoop();
  startStaleWatcher();
  setStatus('stale', 'Awaiting sender…');
  log('info', 'boot', 'receiver online v' + PROTOCOL_VERSION);
  if (standaloneMode) exposeStandaloneApi();
}

// Expose a minimal API for standalone preview/QA — Playwright and devtools
// can pump messages without a real Cast session. Also auto-seeds a queue when
// the page opens with ?demo=1 or ?track=<id> so the receiver renders the same
// way it would on a real TV with a sender connected. This lets every reviewer
// hit `npm run cast:preview` and see the final 10-foot UI in a browser tab.
function exposeStandaloneApi() {
  window.__castReceiver = {
    standalone: true,
    runtime,
    audio: standaloneAudio,
    loadQueue: (items, startIndex = 0) => onQueueLoad({ items, startIndex, autoplay: true }),
    setLyrics: (trackId, lines) => applyLyrics({ trackId, lines }),
    play: () => playerManager.play(),
    pause: () => playerManager.pause(),
    seek: (s: number) => playerManager.seek(s),
    current: () => currentItem(),
    state: () => ({
      playing: playerManager.getPlayerState?.() === 'PLAYING',
      position: playerManager.getCurrentTimeSec?.() ?? 0,
      duration: playerManager.getDurationSec?.() ?? 0,
      trackId: currentItem()?.id ?? null
    })
  };
  setStatus('stale', 'Standalone preview · pump via __castReceiver');
  // Browser autoplay policy blocks the first play() until a user gesture.
  // The first click/key/touch anywhere on the page resumes playback if we
  // had to defer it. One handler covers all input modalities (mouse, touch,
  // keyboard, gamepad-as-keyboard via D-pad).
  const resumeOnGesture = () => {
    // A gesture means the AudioContext is now allowed — unlock the analyser so
    // the visualizer binds to real audio, and resume the ctx if it exists.
    audioUnlocked = true;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => { /* policy */ });
    if (!pendingAutoplayResume || !standaloneAudio) return;
    pendingAutoplayResume = false;
    standaloneAudio.play().catch(() => { pendingAutoplayResume = true; });
  };
  ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((evt) => {
    document.addEventListener(evt, resumeOnGesture, { passive: true });
  });
  maybeAutoSeed();
}

// URL-driven test/demo seed:
//   ?test        → load the full catalog + autoplay (laptop test of the TV UI)
//   ?demo=1      → same as ?test (legacy alias)
//   ?track=<id>  → start at one specific track
//   ?autoplay=0  → boot paused so click-to-play is testable without the
//                  browser's user-gesture autoplay friction
// Open https://music.megabyte.space/cast-receiver/?test on a laptop to preview
// exactly what the Chromecast renders, with songs loading automatically.
function maybeAutoSeed() {
  try {
    const params = new URLSearchParams(window.location.search);
    const wantsTest = params.has('test') || params.get('demo') === '1';
    const trackId = params.get('track');
    const autoplay = params.get('autoplay') !== '0';
    if (!wantsTest && !trackId) return;
    const items = TRACKS.map(t => {
      const album = ALBUMS.find(a => a.trackIds.includes(t.id));
      const cover = album?.cover ?? '/art/cover-panda-desiiignare.png';
      return {
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: album?.name ?? 'bZ',
        cover: new URL(cover, location.href).toString(),
        audio: new URL(t.file, location.href).toString(),
        vibe: t.vibe
      } satisfies ReceiverQueueItem;
    });
    const startIndex = trackId ? Math.max(0, items.findIndex(x => x.id === trackId)) : 0;
    log('info', 'preview', `auto-seed ${items.length} tracks start=${items[startIndex]?.id ?? '?'} autoplay=${autoplay}`);
    onQueueLoad({ items, startIndex, autoplay, startPosition: 0 });
  } catch (err) {
    logErr('auto-seed', err);
  }
}

// ─── Sender → receiver dispatch ─────────────────────────────────────────────
function handleSenderMessage(event: any) {
  wakeUI(); // a sender (phone remote) is interacting → light up the queue rail
  const senderId: string = event.senderId ?? 'unknown';
  let msg: unknown;
  try {
    msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
  } catch (err) {
    logErr('parse-msg', err);
    return;
  }
  if (!isCastMsg(msg)) {
    log('warn', 'msg', 'malformed message ignored');
    return;
  }
  if (msg.v && msg.v > PROTOCOL_VERSION) {
    log('warn', 'msg', `protocol mismatch: sender v${msg.v}, receiver v${PROTOCOL_VERSION}`);
  }
  try { dispatch(msg, senderId); }
  catch (err) { logErr('dispatch:' + msg.type, err); errorOut('dispatch_failed', err); }
}

function dispatch(msg: CastMsg<unknown>, senderId: string) {
  switch (msg.type) {
    case 'hello':
      lastSenderHelloAt = Date.now();
      log('info', 'hello', `sender ${senderId} v${(msg.payload as HelloPayload | undefined)?.appVersion ?? '?'}`);
      broadcast(true);
      break;
    case 'queue:load':
      onQueueLoad(msg.payload as QueueLoadPayload);
      break;
    case 'queue:insert':
      onQueueInsert(msg.payload as InsertPayload);
      break;
    case 'queue:remove':
      onQueueRemove(msg.payload as RemovePayload);
      break;
    case 'queue:reorder':
      onQueueReorder(msg.payload as ReorderPayload);
      break;
    case 'queue:select':
      onQueueSelect(msg.payload as SelectPayload);
      break;
    case 'transport:play':
      safe(() => playerManager.play());
      break;
    case 'transport:pause':
      safe(() => playerManager.pause());
      break;
    case 'transport:seek':
      onSeek(msg.payload as SeekPayload);
      break;
    case 'transport:next':
      stepTrack(1);
      break;
    case 'transport:prev':
      stepTrack(-1);
      break;
    case 'transport:volume':
      onVolume(msg.payload as VolumePayload);
      break;
    case 'transport:mute':
      onMute(msg.payload as MutePayload);
      break;
    case 'view:set':
      setView((msg.payload as ViewPayload).view);
      break;
    case 'palette:set':
      applyPalette(msg.payload as PalettePayload);
      break;
    case 'lyrics:set':
      applyLyrics(msg.payload as LyricsPayload);
      break;
    case 'state:request':
      broadcast(true);
      break;
    case 'ping':
      send('pong', { ts: Date.now() });
      break;
    case 'log':
      // Sender forwarded a console event for diagnostics
      console.log('[sender]', msg.payload);
      break;
    default:
      log('warn', 'msg', 'unknown type: ' + msg.type);
  }
}

// ─── Queue ops ──────────────────────────────────────────────────────────────
function onQueueLoad(p: QueueLoadPayload) {
  if (!p?.items?.length) { errorOut('empty_queue', new Error('queue:load with zero items')); return; }
  runtime.queue = p.items.slice(0, 200);
  if (typeof p.shuffle === 'boolean') runtime.shuffle = p.shuffle;
  // Force loop:'all' unless the sender explicitly asks for 'one'. The receiver
  // must keep cycling the whole playlist forever — including AFTER the caster
  // disconnects — starting from whatever track was first cast. (A sender that
  // omits loop, or sends 'off', still loops here.)
  runtime.loop = p.loop === 'one' ? 'one' : 'all';
  const startIdx = clamp(p.startIndex ?? 0, 0, runtime.queue.length - 1);
  runtime.index = startIdx;
  runtime.focusedIndex = startIdx;
  renderQueue();
  if (p.autoplay !== false) loadAndPlay(runtime.queue[startIdx], p.startPosition ?? 0);
  else { wakeUI(); renderUI(); primeLyrics(runtime.queue[startIdx]); } // show synced lyrics even while paused
  broadcast(true);
  toast(`Queue loaded · ${runtime.queue.length} tracks`, 'success', 1500);
}

function onQueueInsert(p: InsertPayload) {
  if (!p?.items?.length) return;
  let at = runtime.queue.length;
  if (p.afterId) {
    const idx = runtime.queue.findIndex(q => q.id === p.afterId);
    if (idx >= 0) at = idx + 1;
  }
  runtime.queue.splice(at, 0, ...p.items);
  if (runtime.queue.length > 200) runtime.queue.length = 200;
  if (runtime.index < 0 && runtime.queue.length) {
    runtime.index = 0;
    loadAndPlay(runtime.queue[0]);
  }
  renderQueue();
  broadcast(true);
}

function onQueueRemove(p: RemovePayload) {
  const idx = runtime.queue.findIndex(q => q.id === p.id);
  if (idx < 0) return;
  runtime.queue.splice(idx, 1);
  if (idx === runtime.index) {
    if (runtime.queue.length === 0) { stop(); }
    else { runtime.index = clamp(runtime.index, 0, runtime.queue.length - 1); loadAndPlay(runtime.queue[runtime.index]); }
  } else if (idx < runtime.index) {
    runtime.index -= 1;
  }
  runtime.focusedIndex = clamp(runtime.focusedIndex, 0, runtime.queue.length - 1);
  renderQueue();
  broadcast(true);
}

function onQueueReorder(p: ReorderPayload) {
  const from = runtime.queue.findIndex(q => q.id === p.id);
  if (from < 0) return;
  const to = clamp(p.toIndex, 0, runtime.queue.length - 1);
  const [item] = runtime.queue.splice(from, 1);
  runtime.queue.splice(to, 0, item);
  if (from === runtime.index) runtime.index = to;
  else if (from < runtime.index && to >= runtime.index) runtime.index -= 1;
  else if (from > runtime.index && to <= runtime.index) runtime.index += 1;
  renderQueue();
  broadcast(true);
}

function onQueueSelect(p: SelectPayload) {
  const idx = runtime.queue.findIndex(q => q.id === p.id);
  if (idx < 0) { errorOut('select_unknown_id', new Error('id ' + p.id + ' not in queue')); return; }
  runtime.index = idx;
  runtime.focusedIndex = idx;
  loadAndPlay(runtime.queue[idx], p.position ?? 0);
  renderQueue();
}

function onSeek(p: SeekPayload) {
  if (!Number.isFinite(p?.position)) return;
  safe(() => playerManager.seek(Math.max(0, p.position)));
}

function onVolume(p: VolumePayload) {
  const lvl = clamp(p.level, 0, 1);
  safe(() => playerManager.setVolume(lvl));
}

function onMute(p: MutePayload) {
  safe(() => playerManager.setMediaElement?.()?.mute?.(p.muted));
}

function stepTrack(dir: 1 | -1) {
  if (runtime.queue.length === 0) return;
  let next = runtime.index + dir;
  if (next < 0) next = runtime.loop === 'all' ? runtime.queue.length - 1 : 0;
  if (next >= runtime.queue.length) next = runtime.loop === 'all' ? 0 : runtime.queue.length - 1;
  if (next === runtime.index) return;
  runtime.index = next;
  runtime.focusedIndex = next;
  loadAndPlay(runtime.queue[next]);
  renderQueue();
}

function onTrackEnded() {
  if (runtime.loop === 'one' && runtime.index >= 0) {
    loadAndPlay(runtime.queue[runtime.index]);
    return;
  }
  if (runtime.index < 0 || runtime.queue.length === 0) return;
  if (runtime.index === runtime.queue.length - 1 && runtime.loop !== 'all') {
    setStatus('live', 'Queue complete');
    return;
  }
  stepTrack(1);
}

function onPlaybackError(e: any) {
  const code = e?.detailedErrorCode ?? e?.detail?.detailedErrorCode;
  const reason = e?.error?.message ?? e?.reason ?? '';
  const cur = runtime.queue[runtime.index];
  const sameTrack = cur && failTrackId === cur.id;
  failCount = sameTrack ? failCount + 1 : 1;
  failTrackId = cur?.id ?? null;

  logErr('playback', { code, reason, attempt: failCount, trackId: failTrackId });

  if (!cur) {
    setStatus('error', 'no track to play');
    return;
  }

  if (failCount > BACKOFF_MS.length) {
    // Give up on this track — surface what happened and move on so the
    // session doesn't strand the user on a single broken object.
    toast(`Skipping ${cur.title} — load failed${code ? ` (${code})` : ''}`, 'error', 3200);
    failCount = 0;
    failTrackId = null;
    clearRecoverTimer();
    stepTrack(1);
    return;
  }

  const wait = BACKOFF_MS[failCount - 1];
  const label = code ? `load failed (${code})` : 'load failed';
  setStatus('error', label);
  toast(`${label} — retry ${failCount}/${BACKOFF_MS.length} in ${Math.round(wait / 1000)}s`, 'error', wait + 200);
  clearRecoverTimer();
  recoverTimer = window.setTimeout(() => {
    recoverTimer = 0;
    const item = runtime.queue[runtime.index];
    if (item) loadAndPlay(item);
  }, wait);
}

function loadAndPlay(item: ReceiverQueueItem, startPosition = 0) {
  if (!item?.audio) { errorOut('no_audio', new Error('queue item missing audio url')); return; }
  hideUpNext(); // clear any "up next" card from the previous track
  setBuffering(false); // reset any stale spinner from the previous track
  wakeUI(); // a new track is a "presence" event → brighten, then auto-dim after 5s
  try {
    // In standalone preview mode (no Cast SDK), window.cast.framework.messages
    // is undefined — pass a plain object that buildStandalonePlayer().load()
    // can read (contentId + currentTime + autoplay). Real Cast runtime builds
    // the SDK-typed MediaInformation/LoadRequestData so playerManager.load
    // populates currentMedia for the sender-side state machine.
    let req: any;
    if (standaloneMode) {
      req = {
        media: { contentId: item.audio, contentType: 'audio/mpeg', customData: { trackId: item.id } },
        autoplay: true,
        currentTime: Math.max(0, startPosition),
      };
    } else {
      const mediaInfo = new window.cast!.framework.messages.MediaInformation();
      mediaInfo.contentId = item.audio;
      mediaInfo.contentType = 'audio/mpeg';
      mediaInfo.streamType = window.cast!.framework.messages.StreamType.BUFFERED;
      const meta = new window.cast!.framework.messages.MusicTrackMediaMetadata();
      meta.title = item.title;
      meta.artist = item.artist;
      meta.albumName = item.album;
      if (item.cover) meta.images = [{ url: item.cover }];
      mediaInfo.metadata = meta;
      mediaInfo.customData = { trackId: item.id };

      req = new window.cast!.framework.messages.LoadRequestData();
      req.media = mediaInfo;
      req.autoplay = true;
      req.currentTime = Math.max(0, startPosition);
    }
    playerManager.load(req);
    primeLyrics(item);
    renderUI();
    setStatus('live', 'Live');
  } catch (err) {
    logErr('loadAndPlay', err);
    errorOut('load_failed', err);
  }
}

function stop() {
  safe(() => playerManager.stop());
  runtime.index = -1;
  setView('idle');
  renderUI();
}

function upsertCurrent(item: ReceiverQueueItem) {
  const at = runtime.queue.findIndex(q => q.id === item.id);
  if (at >= 0) { runtime.queue[at] = item; runtime.index = at; }
  else { runtime.queue.unshift(item); runtime.index = 0; }
  runtime.focusedIndex = runtime.index;
  renderQueue();
  renderUI();
}

// ─── Render ─────────────────────────────────────────────────────────────────
function renderUI() {
  const cur = currentItem();
  if (!cur) {
    setView('idle');
    return;
  }
  // setView('idle') sets stage.dataset.view='idle' but runtime.view='now-playing'
  // (the type doesn't allow 'idle'), so check the DOM to detect the splash state.
  const stageView = $('#stage')?.dataset.view;
  if (stageView === 'idle') setView('now-playing');
  setText('#title', cur.title);
  setText('#artist', cur.artist);
  setText('#album', cur.album);
  setText('#eyebrow', cur.vibe || 'Casting from music.megabyte.space');
  renderMetaChips(cur);
  const art = $('#artImg') as HTMLImageElement | null;
  if (art && cur.cover && art.src !== cur.cover) {
    // Crossfade to the new cover.
    art.style.opacity = '0';
    art.onload = () => { art.style.opacity = '1'; };
    art.onerror = () => { logErr('art', new Error('art load failed: ' + cur.cover)); art.src = '/art/cover-panda-desiiignare.png'; };
    art.src = cur.cover;
    // Sheen sweep on track change — re-trigger the CSS animation by toggling
    // the class across a reflow.
    const wrap = $('#artWrap');
    if (wrap && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      wrap.classList.remove('is-fresh');
      void wrap.offsetWidth;
      wrap.classList.add('is-fresh');
    }
  }
  // Per-track color from the cover (receiver-side). Runs once per track; sender
  // palette:set still overrides via the paletteFromSender guard.
  if (cur.cover && lastPaletteTrackId !== cur.id) {
    lastPaletteTrackId = cur.id;
    paletteFromSender = false;
    extractPaletteFromCover(new URL(cur.cover, location.href).toString());
  }
}

// Meta chip row under the title — track position, runtime, source. Mirrors the
// main site's playbar chips (BPM/key aren't in the cast payload, so we surface
// what the receiver actually has: position, duration, live source).
function renderMetaChips(cur: ReceiverQueueItem) {
  const host = $('#npChips');
  if (!host) return;
  const pos = runtime.index >= 0 ? runtime.index + 1 : 1;
  const total = runtime.queue.length || 1;
  const durSec = playerManager.getDurationSec?.() ?? cur.duration ?? 0;
  const dur = durSec > 0 ? fmtTime(durSec) : null;
  const chips: string[] = [
    `<span class="np__chip np__chip--num">${pos}<i>/</i>${total}</span>`,
    cur.bpm ? `<span class="np__chip"><b>${cur.bpm}</b><i>BPM</i></span>` : '',
    cur.musicalKey ? `<span class="np__chip np__chip--key">${escHtml(cur.musicalKey)}</span>` : '',
    dur ? `<span class="np__chip">${dur}</span>` : ''
  ].filter(Boolean);
  host.innerHTML = chips.join('');
}

function renderQueue() {
  const list = $('#queueList');
  const count = $('#queueCount');
  if (count) count.textContent = String(runtime.queue.length);
  if (!list) return;
  list.innerHTML = '';
  runtime.queue.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'queue__item';
    li.dataset.idx = String(i);
    li.dataset.id = item.id;
    if (i === runtime.index) li.classList.add('is-now');
    if (i === runtime.focusedIndex) li.classList.add('is-focused');
    li.innerHTML = `
      <img class="queue__item-cover" src="${escAttr(item.cover)}" alt="" onerror="this.style.opacity=0.2" />
      <div class="queue__item-text">
        <span class="queue__item-title">${escHtml(item.title)}</span>
        <span class="queue__item-sub">${escHtml(item.artist)}${item.album ? ' · ' + escHtml(item.album) : ''}</span>
      </div>
      <span class="queue__item-tag">${i === runtime.index ? 'NOW' : pad2(i + 1)}</span>
    `;
    list.appendChild(li);
  });
  scrollFocusedIntoView();
}

function renderLyrics() {
  const inner = $('#lyricsInner');
  if (!inner) return;
  lyricLineEls = [];
  activeWordEls = [];
  if (!runtime.lyrics.length) {
    // No lyrics yet: distinguish "still loading" from "this track has none".
    inner.innerHTML = lyricsMissing
      ? '<p class="lyrics__line is-instrumental"><span class="lyrics__note">♪</span>Instrumental</p>'
      : '<p class="lyrics__line is-empty">Lyrics syncing…</p>';
    return;
  }
  inner.innerHTML = runtime.lyrics.map((l, i) => {
    const words = l.words ?? [];
    if (words.length) {
      const spans = words
        .map((w, wi) => `<span class="lyrics__w" data-idx="${wi}">${escHtml(w.w)}</span>`)
        .join(' ');
      return `<p class="lyrics__line" data-idx="${i}">${spans}</p>`;
    }
    return `<p class="lyrics__line" data-idx="${i}">${escHtml(l.text)}</p>`;
  }).join('');
  lyricLineEls = Array.from(inner.querySelectorAll<HTMLElement>('.lyrics__line'));
}

function updateProgress() {
  const cur = playerManager.getCurrentTimeSec?.() ?? 0;
  const dur = playerManager.getDurationSec?.() ?? 0;
  setText('#now', fmtTime(cur));
  setText('#total', fmtTime(dur));
  const fill = $('#progFill') as HTMLElement | null;
  if (fill) fill.style.width = (dur > 0 ? Math.max(0, Math.min(1, cur / dur)) * 100 : 0).toFixed(1) + '%';
  updateUpNext(dur > 0 ? dur - cur : 0, dur);
  // Word-level lyric highlighting is driven from the rAF loop (60fps) for smooth
  // sync — TIME_UPDATE only fires a few times/sec, which made words jump.
  pendingState = true;
}

// The track that will play next, mirroring stepTrack(1): index+1, wrapping to 0
// when loop is 'all'. Returns null on loop:'one' or the last track without loop.
function peekNextTrack(): ReceiverQueueItem | null {
  if (runtime.queue.length === 0 || runtime.index < 0) return null;
  if (runtime.loop === 'one') return null;
  let next = runtime.index + 1;
  if (next >= runtime.queue.length) {
    if (runtime.loop === 'all') next = 0;
    else return null;
  }
  if (next === runtime.index) return null;
  return runtime.queue[next] ?? null;
}

// Slide the "Up Next" card in during the last ~12s of a playing track.
function updateUpNext(remaining: number, dur: number) {
  const card = $('#upNext');
  if (!card) return;
  const next = peekNextTrack();
  const show = dur > 12 && remaining > 1 && remaining <= 12 && !!next
    && playerManager.getPlayerState?.() === 'PLAYING';
  if (show && next) {
    if (upNextShownFor !== next.id) {
      upNextShownFor = next.id;
      setText('#upNextTitle', next.title);
      setText('#upNextArtist', next.artist);
      const img = $('#upNextArt') as HTMLImageElement | null;
      if (img && next.cover) img.src = next.cover;
    }
    card.classList.add('is-on');
    card.setAttribute('aria-hidden', 'false');
  } else {
    hideUpNext();
  }
}
function hideUpNext() {
  const card = $('#upNext');
  if (!card) return;
  card.classList.remove('is-on');
  card.setAttribute('aria-hidden', 'true');
  upNextShownFor = null;
}

function tickLyrics(now: number) {
  if (!runtime.lyrics.length || !lyricLineEls.length) return;
  // Active line via binary search on line start times. Clamp to 0 so the FIRST
  // line is selected the moment the song starts — a long instrumental intro
  // (e.g. chef-lu-stew's vocal enters ~21s in) otherwise leaves no line selected
  // and reads as a broken/unsynced screen. The first line's words stay unfilled
  // (--fill 0) until their own timestamps, so it's highlighted-but-not-yet-sung.
  let active = -1, lo = 0, hi = runtime.lyrics.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (runtime.lyrics[mid].t <= now) { active = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (active < 0) active = 0;
  if (active !== lastLyricsActiveIdx) {
    lastLyricsActiveIdx = active;
    for (let i = 0; i < lyricLineEls.length; i++) {
      const el = lyricLineEls[i];
      el.classList.toggle('is-active', i === active);
      el.classList.toggle('is-past', i < active);
      el.classList.toggle('is-soon', i === active + 1);
    }
    activeWordEls = Array.from(lyricLineEls[active].querySelectorAll<HTMLSpanElement>('.lyrics__w'));
    const wrap = $('#lyrics') as HTMLElement | null;
    const target = lyricLineEls[active];
    const inner = $('#lyricsInner') as HTMLElement | null;
    if (target && inner && wrap) {
      const offset = (target.offsetTop + target.offsetHeight / 2) - (wrap.clientHeight / 2);
      inner.style.transform = `translateY(${-offset}px)`;
    }
  }
  // Karaoke word-fill: each word in the active line fills left→right (sung white,
  // unsung dim) via --fill (0→1). Smooth because this runs every rAF frame.
  if (active < 0) return;
  const words = runtime.lyrics[active]?.words;
  if (!words || !words.length || !activeWordEls.length) return;
  for (let i = 0; i < words.length; i++) {
    const span = activeWordEls[i];
    if (!span) continue;
    const w = words[i];
    const f = now >= w.e ? 1 : now < w.s ? 0 : (now - w.s) / Math.max(0.06, w.e - w.s);
    span.style.setProperty('--fill', f.toFixed(3));
  }
}

function applyPalette(p: PalettePayload) {
  const root = document.documentElement.style;
  // Brand is black + cyan: the background stays deep-black (set in CSS), and we
  // tint ONLY the accent/secondary/violet hues from the album art so the aurora
  // + visualizer + glows shift per track without ever washing the page to a
  // non-brand color. (Old behavior repainted the whole bg from album hue.)
  if (p.accent) root.setProperty('--accent', p.accent);
  // Secondary accent: prefer the album's vibrant, else its muted, else keep brand.
  if (p.vibrant || p.muted) root.setProperty('--accent-2', p.vibrant || p.muted || '#50aae3');
  if (p.muted) root.setProperty('--violet', p.muted);
  if (p.ink) root.setProperty('--ink', p.ink);
  paletteFromSender = true; // sender push is authoritative over receiver extraction
}

// Receiver-side palette: pull a vibrant accent + secondary from the cover art so
// EVERY track gets its own color (aurora/glow/viz/title sheen shift per track)
// even with no sender push (standalone preview, or a sender that omits palette).
// Same-origin covers → canvas is not tainted. Cheap: one 24×24 read per track.
function applyExtracted(p: { accent: string; accent2: string; violet: string }) {
  if (paletteFromSender) return; // never override a sender palette
  const root = document.documentElement.style;
  root.setProperty('--accent', p.accent);
  root.setProperty('--accent-2', p.accent2);
  root.setProperty('--violet', p.violet);
}
function extractPaletteFromCover(url: string) {
  if (!url) return;
  const cached = paletteCache.get(url);
  if (cached) { applyExtracted(cached); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const n = 24;
      const cv = document.createElement('canvas');
      cv.width = n; cv.height = n;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      if (!cx) return;
      cx.drawImage(img, 0, 0, n, n);
      const d = cx.getImageData(0, 0, n, n).data;
      let best = { score: -1, h: 190 }, second = { score: -1, h: 210 };
      for (let i = 0; i < d.length; i += 4) {
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        if (l < 0.18 || l > 0.82) continue;              // skip near-black/white
        const score = s * (1 - Math.abs(l - 0.55));       // vibrant + mid-light
        if (score > best.score) { second = best; best = { score, h }; }
        else if (score > second.score && Math.abs(h - best.h) > 40) second = { score, h };
      }
      const pal = {
        accent: `hsl(${Math.round(best.h)} 92% 62%)`,
        accent2: `hsl(${Math.round(second.h)} 85% 60%)`,
        violet: `hsl(${Math.round(best.h)} 70% 46%)`,
      };
      paletteCache.set(url, pal);
      const curUrl = currentItem() ? new URL(currentItem()!.cover, location.href).toString() : '';
      if (curUrl === url) applyExtracted(pal);
    } catch { /* tainted/canvas blocked → keep brand cyan */ }
  };
  img.src = url;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

// Core lyric setter — sorts, stores, records the source, re-renders.
function setLyricsLines(trackId: string, lines: ReceiverLine[], source: 'self' | 'sender') {
  runtime.lyricsTrackId = trackId;
  runtime.lyrics = lines.slice().sort((a, b) => a.t - b.t);
  lyricsSource = source;
  lyricsMissing = false; // real lyrics arrived → clear any instrumental state
  lastLyricsActiveIdx = -2;
  lastLyricsActiveWordIdx = -2;
  renderLyrics();
}

// Sender / shim entry point. IGNORE pushes that don't match the track actually
// playing (prevents a stale push showing the WRONG song), and never override an
// authoritative self-fetch.
function applyLyrics(p: LyricsPayload) {
  if (!p?.trackId) return;
  const cur = currentItem()?.id;
  if (cur && p.trackId !== cur) return;       // wrong-track push → drop
  if (lyricsSource === 'self') return;        // self-fetch is authoritative
  setLyricsLines(p.trackId, p.lines ?? [], 'sender');
}

// Reset + render lyrics for a track, then self-fetch them. Called whether the
// track is playing or merely loaded (paused), so lyrics always show.
function primeLyrics(item: ReceiverQueueItem | undefined) {
  if (!item) return;
  runtime.lyricsTrackId = item.id;
  runtime.lyrics = [];
  lyricsSource = null;
  lyricsMissing = false;
  lastLyricsActiveIdx = -2;
  lastLyricsActiveWordIdx = -2;
  renderLyrics();
  void selfFetchLyrics(item);
  void enrichMeta(item);
}

// Self-fetch word-timed lyrics from the same origin (/lyrics/<id>.json). These
// timings match the EXACT MP3 the receiver streams, so they are AUTHORITATIVE —
// they override any sender push and drive precise word-level highlighting. Works
// in the standalone ?test preview too.
async function selfFetchLyrics(item: ReceiverQueueItem) {
  const token = ++lyricsFetchToken;
  try {
    const r = await fetch(`/lyrics/${encodeURIComponent(item.id)}.json`, { cache: 'force-cache' });
    if (!r.ok) { markLyricsMissing(item.id, token); return; }
    // A misbehaving origin can return 200 with the SPA HTML shell for a missing
    // file; parse defensively so HTML-as-JSON is "missing", not a stuck "syncing…".
    const data = await r.json().catch(() => null) as { lines?: Array<{ s: number; e?: number; text: string }>; words?: Array<{ w: string; s: number; e: number; line?: number }> } | null;
    if (!data) { markLyricsMissing(item.id, token); return; }
    // Stale guard: track changed or a newer fetch superseded this one.
    if (token !== lyricsFetchToken || currentItem()?.id !== item.id) return;
    const rawLines = data.lines ?? [];
    const rawWords = (data.words ?? []).filter(w => typeof w.s === 'number').slice().sort((a, b) => a.s - b.s);
    // Assign each word to a line. Many lyrics files OMIT the per-word `line`
    // field (11/72 as of 2026-06-08) — relying on it dropped every word to
    // line -1 → those tracks got NO word-level highlight. Group by TIME instead
    // (the latest line whose start ≤ the word's start), which works for every
    // file; fall back to the `line` field only when it's present on all words.
    const buckets: Array<Array<{ w: string; s: number; e: number }>> = rawLines.map(() => []);
    const hasLineField = rawWords.length > 0 && rawWords.every(w => Number.isInteger(w.line));
    for (const w of rawWords) {
      let li = -1;
      if (hasLineField) {
        li = w.line as number;
      } else {
        for (let i = 0; i < rawLines.length; i++) { if (rawLines[i].s <= w.s) li = i; else break; }
      }
      if (li >= 0 && li < buckets.length) buckets[li].push({ w: w.w, s: w.s, e: w.e });
    }
    const lines: ReceiverLine[] = rawLines.map((l, i) => {
      const lw = buckets[i].sort((a, b) => a.s - b.s); // monotonic so the fill wipes left→right
      return { t: l.s, e: l.e, text: l.text, ...(lw.length ? { words: lw } : {}) } as ReceiverLine;
    });
    if (lines.length) setLyricsLines(item.id, lines, 'self'); // authoritative
    else markLyricsMissing(item.id, token);                   // file exists but empty
  } catch { /* offline / transient → keep sender push or "syncing…" (don't claim instrumental) */ }
}

// A self-fetch confirmed this track has no usable lyrics (404 or empty file).
// Show the gorgeous "instrumental" state — but only if this is still the current
// track, the fetch wasn't superseded, and no sender push has filled the lyrics.
function markLyricsMissing(trackId: string, token: number) {
  if (token !== lyricsFetchToken || currentItem()?.id !== trackId) return;
  if (lyricsSource === 'sender' || runtime.lyrics.length) return;
  lyricsMissing = true;
  renderLyrics();
}

// Compact per-track BPM + key map (public/cast-meta.json, ~2kB), fetched once.
// Real Cast items already carry bpm/musicalKey from the sender; this enriches the
// standalone ?test preview and acts as a fallback when a sender omits them.
function loadCastMeta() {
  if (!castMetaPromise) {
    castMetaPromise = fetch('/cast-meta.json', { cache: 'force-cache' })
      .then(r => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return castMetaPromise;
}
async function enrichMeta(item: ReceiverQueueItem) {
  if (item.bpm && item.musicalKey) return; // sender already provided both
  const map = await loadCastMeta();
  const m = map[item.id];
  if (!m) return;
  if (m.bpm && !item.bpm) item.bpm = m.bpm;
  if (m.key && !item.musicalKey) item.musicalKey = m.key;
  if (currentItem()?.id === item.id) renderMetaChips(item);
}

function setView(view: ReceiverView | 'idle') {
  runtime.view = (view === 'idle' ? 'now-playing' : view);
  const stage = $('#stage') as HTMLElement | null;
  if (stage) stage.dataset.view = view;

  // a11y: the idle splash and the live content (now-playing + lyrics + queue,
  // all simultaneously in the grid) are mutually exclusive. Mark the inactive
  // group inert + aria-hidden so assistive tech — and the focused #queueList —
  // never live inside an aria-hidden subtree (Chrome logs that as an error).
  const idle = view === 'idle';
  const splash = $('#idleSplash') as HTMLElement | null;
  const content = ['#nowPlaying', '#lyrics', '#queue'].map(s => $(s) as HTMLElement | null);
  setHidden(splash, !idle);
  for (const el of content) setHidden(el, idle);
}

/** Toggle aria-hidden + inert together, blurring focus out of a hidden subtree. */
function setHidden(el: HTMLElement | null, hidden: boolean) {
  if (!el) return;
  el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
  (el as HTMLElement & { inert: boolean }).inert = hidden;
  if (hidden && el.contains(document.activeElement)) {
    (document.activeElement as HTMLElement | null)?.blur();
  }
}

function scrollFocusedIntoView() {
  const list = $('#queueList');
  if (!list) return;
  const target = list.querySelector('.queue__item.is-focused') as HTMLElement | null;
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ─── D-pad keyboard ────────────────────────────────────────────────────────
// ── UI wake ───────────────────────────────────────────────────────────────
// The queue rail rests at opacity 0.25 (CSS). Any controller signal — D-pad
// key, sender message, touch — flips body.ui-awake → CSS fades it to 1 over
// 0.333s. After 5s of silence it auto-dims again so the now-playing + wave
// visualizer own the 10-foot screen.
function wakeUI() {
  document.body.classList.add('ui-awake');
  if (uiAwakeTimer) clearTimeout(uiAwakeTimer);
  uiAwakeTimer = setTimeout(() => document.body.classList.remove('ui-awake'), 5000) as unknown as number;
}

// Buffering overlay with a 350ms debounce so brief micro-stalls don't flicker
// a spinner. on=true schedules the show; on=false cancels/hides immediately.
function setBuffering(on: boolean) {
  const el = $('#buffering');
  if (!el) return;
  if (on) {
    if (bufferTimer || el.classList.contains('is-on')) return;
    bufferTimer = window.setTimeout(() => {
      bufferTimer = 0;
      el.classList.add('is-on');
      el.setAttribute('aria-hidden', 'false');
    }, 350) as unknown as number;
  } else {
    if (bufferTimer) { clearTimeout(bufferTimer); bufferTimer = 0; }
    el.classList.remove('is-on');
    el.setAttribute('aria-hidden', 'true');
  }
}

function setupKeyboard() {
  document.addEventListener('keydown', () => wakeUI(), { passive: true, capture: true });
  document.addEventListener('pointermove', () => wakeUI(), { passive: true });
  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (runtime.view === 'queue') {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        const dir = k === 'ArrowDown' ? 1 : -1;
        runtime.focusedIndex = clamp(runtime.focusedIndex + dir, 0, runtime.queue.length - 1);
        renderQueue();
        return;
      }
      if (k === 'Enter' || k === ' ') {
        e.preventDefault();
        const item = runtime.queue[runtime.focusedIndex];
        if (item) onQueueSelect({ id: item.id });
        return;
      }
      if (k === 'Backspace' || k === 'Escape' || k === 'GoBack') {
        e.preventDefault();
        setView('now-playing');
        broadcast(true);
        return;
      }
    } else {
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        e.preventDefault();
        setView('queue');
        broadcast(true);
        return;
      }
      if (k === 'ArrowRight') {
        e.preventDefault();
        const cur = playerManager.getCurrentTimeSec?.() ?? 0;
        playerManager.seek(cur + 10);
        return;
      }
      if (k === 'ArrowLeft') {
        e.preventDefault();
        const cur = playerManager.getCurrentTimeSec?.() ?? 0;
        playerManager.seek(Math.max(0, cur - 10));
        return;
      }
      if (k === 'Enter' || k === ' ' || k === 'MediaPlayPause') {
        e.preventDefault();
        const playing = playerManager.getPlayerState?.() === 'PLAYING';
        if (playing) playerManager.pause(); else playerManager.play();
        return;
      }
      if (k === 'MediaTrackNext') { e.preventDefault(); stepTrack(1); return; }
      if (k === 'MediaTrackPrevious') { e.preventDefault(); stepTrack(-1); return; }
    }
  });
}

// ─── Visualizer ────────────────────────────────────────────────────────────
// Real-FFT bars + palette-driven ambient blobs. Mirrors src/visualizer.ts on
// the sender so the 10-foot UI feels continuous with the website.
//
// Audio graph: <audio> → MediaElementAudioSourceNode → AnalyserNode → destination.
// The MediaElementAudioSourceNode is built lazily once per element (creating it
// twice on the same element throws InvalidStateError) and cached on `__bzSrc`.
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let analyserFreq: Uint8Array | null = null;
let analyserTime: Uint8Array | null = null;
let analyserBound: HTMLMediaElement | null = null;

function ensureAnalyser(): AnalyserNode | null {
  // Don't create/resume the AudioContext before playback is allowed — avoids the
  // autoplay-policy console warning. Synthetic wave covers the pre-unlock window.
  if (!audioUnlocked) return null;
  const el: HTMLMediaElement | null = standaloneAudio ?? (playerManager.getMediaElement?.() as HTMLMediaElement | null) ?? null;
  if (!el) return null;
  if (analyser && analyserBound === el) return analyser;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const node = analyser ?? audioCtx.createAnalyser();
    // 2048 fft → 1024 time-domain samples: smooth oscilloscope wave (matches
    // the main app's wave mode). smoothing 0.82 keeps the line silky at 10ft.
    node.fftSize = 2048;
    node.smoothingTimeConstant = 0.82;
    let src: MediaElementAudioSourceNode | undefined = (el as any).__bzSrc;
    if (!src) {
      src = audioCtx.createMediaElementSource(el);
      (el as any).__bzSrc = src;
    }
    try { (src as any).disconnect(); } catch { /* first bind */ }
    src.connect(node);
    node.connect(audioCtx.destination);
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {/* autoplay policy */});
    analyser = node;
    analyserBound = el;
    analyserFreq = new Uint8Array(node.frequencyBinCount);
    analyserTime = new Uint8Array(node.fftSize);
    return node;
  } catch (err) {
    logErr('analyser-init', err);
    return null;
  }
}

function startVisualizer() {
  const canvas = $('#viz') as HTMLCanvasElement | null;
  if (!canvas) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // DPR cap: Android TV panels are 1080p with dpr≈1, but some report 1.5-2 and
  // then can't fill that many pixels at 60fps. Cap at 1.5, drop to 1 in lite.
  let dpr = Math.min(1.5, window.devicePixelRatio || 1);
  const resize = () => {
    dpr = vizQuality === 'lite' ? 1 : Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
  };
  resize();
  window.addEventListener('resize', resize);
  const ctx2 = canvas.getContext('2d', { alpha: true });
  if (!ctx2) return;

  // Drifting particle field — cheap depth cue behind the bars. Seeded once.
  const PARTICLES = 46;
  const parts = Array.from({ length: PARTICLES }, () => ({
    x: Math.random(), y: Math.random(),
    r: 0.4 + Math.random() * 1.6,
    sp: 0.02 + Math.random() * 0.06,
    ph: Math.random() * Math.PI * 2
  }));

  let blobPhase = 0;
  let lastBeatAt = 0;

  // Adaptive performance for ANY Android TV WebView:
  //  • Rolling FPS estimate (EMA of frame delta) — not just a one-time warmup
  //    probe, so sustained jank mid-playback ALSO downshifts to lite.
  //  • In lite, cap the draw rate to ~40fps (skip frames) to leave the TV's
  //    weak GPU/CPU headroom for audio decode + Shaka.
  //  • Pause entirely while the tab/app is backgrounded.
  let fpsEMA = 60, lastT = 0, warmFrames = 0;
  const LITE_FRAME_MS = 1000 / 40;
  let lastDrawT = 0;

  const tick = (t: number) => {
    requestAnimationFrame(tick);
    if (document.hidden) return;
    // Smooth word-level lyric highlighting — runs every frame (cheap: tickLyrics
    // only touches the DOM when the active line/word changes), even in lite.
    if (runtime.lyrics.length) tickLyrics(playerManager.getCurrentTimeSec?.() ?? 0);
    if (lastT) {
      const dt = t - lastT;
      if (dt > 0 && dt < 500) fpsEMA = fpsEMA * 0.9 + (1000 / dt) * 0.1;
      warmFrames++;
      // After ~1s warmup, if sustained FPS is weak, drop to lite (once).
      if (warmFrames > 60 && fpsEMA < 46 && vizQuality === 'high') {
        vizQuality = 'lite';
        document.documentElement.classList.add('no-gpu');
        resize();
      }
    }
    lastT = t;

    // Lite frame cap — skip draws to hold ~40fps and free the CPU.
    if (vizQuality === 'lite') {
      if (t - lastDrawT < LITE_FRAME_MS) return;
      lastDrawT = t;
    }

    const w = canvas.width, h = canvas.height;
    ctx2.clearRect(0, 0, w, h);
    const playing = playerManager.getPlayerState?.() === 'PLAYING';
    const accent = getCSS('--accent') || '#00e5ff';
    const accent2 = getCSS('--accent-2') || '#50aae3';
    const violet = getCSS('--violet') || '#7c3aed';
    const lite = vizQuality === 'lite';

    // ── Layer 1: drifting particles (skipped in lite / reduced) ──────────
    if (!lite && !reduced) {
      for (const p of parts) {
        p.ph += p.sp * 0.02;
        const py = (p.y + Math.sin(p.ph) * 0.02 + 1) % 1;
        const px = (p.x + Math.cos(p.ph * 0.7) * 0.01 + 1) % 1;
        ctx2.beginPath();
        ctx2.arc(px * w, py * h, p.r * dpr, 0, Math.PI * 2);
        ctx2.fillStyle = hexToRgba(accent, 0.10 + 0.12 * Math.abs(Math.sin(p.ph)));
        ctx2.fill();
      }
    }

    // ── Read FFT (for bass/beat) + time-domain (for the wave) ────────────
    const an = ensureAnalyser();
    let bassSum = 0, bassN = 0;
    if (an && analyserFreq) {
      an.getByteFrequencyData(analyserFreq);
      const bins = analyserFreq.length;
      const bassCut = Math.max(2, Math.floor(bins * 0.08));
      for (let j = 0; j < bassCut; j++) { bassSum += analyserFreq[j]; bassN++; }
    }
    if (an && analyserTime) an.getByteTimeDomainData(analyserTime);

    // ── Beat → --beat CSS var (drives the album-glow ring + aurora) ──────
    const bass = bassN ? (bassSum / bassN) / 255 : (playing ? 0.3 : 0.08);
    beatEnergy = beatEnergy * 0.86 + bass * 0.14;
    const pulse = Math.max(0, Math.min(1, (bass - beatEnergy) * 3 + bass * 0.5));
    if (bass > beatEnergy * 1.25 && t - lastBeatAt > 180) lastBeatAt = t;
    const beat = playing ? pulse : 0;
    document.documentElement.style.setProperty('--beat', beat.toFixed(3));

    // ── Centered radial bass bloom behind the wave ───────────────────────
    if (!lite) {
      const cx = w / 2, cy = h * 0.5;
      const rr = Math.max(w, h) * (0.20 + bass * 0.24);
      const bloom = ctx2.createRadialGradient(cx, cy, 0, cx, cy, rr);
      bloom.addColorStop(0, hexToRgba(accent, 0.14 + bass * 0.18));
      bloom.addColorStop(0.5, hexToRgba(violet, 0.06));
      bloom.addColorStop(1, hexToRgba(accent, 0));
      ctx2.fillStyle = bloom;
      ctx2.fillRect(0, 0, w, h);
    }

    // ── Ambient palette blobs (always, so idle has life) ─────────────────
    blobPhase += 0.003;
    const blobAlpha = lite ? 0.10 : 0.16;
    const blobs: Array<[number, number, string, number]> = [
      [0.20 + 0.07 * Math.sin(blobPhase), 0.28 + 0.05 * Math.cos(blobPhase * 0.9), accent, blobAlpha],
      [0.80 + 0.05 * Math.cos(blobPhase * 1.1), 0.42 + 0.06 * Math.sin(blobPhase * 0.7), accent2, blobAlpha * 0.85]
    ];
    for (const [bx, by, color, alpha] of blobs) {
      const r = Math.max(w, h) * 0.5;
      const grad = ctx2.createRadialGradient(bx * w, by * h, 0, bx * w, by * h, r);
      grad.addColorStop(0, hexToRgba(color, alpha));
      grad.addColorStop(1, hexToRgba(color, 0));
      ctx2.fillStyle = grad;
      ctx2.fillRect(0, 0, w, h);
    }

    // ── WAVE visualizer — multi-layer additive oscilloscope (ported from the
    //    regular app's `wave` mode). Time-domain samples drawn as glowing,
    //    color-shifted, additively-blended lines around the vertical center,
    //    amplitude pumped by beat + bass. Reads gorgeous on a 10-foot screen.
    const cy = h / 2;
    const phase = t / 1000;
    let timeArr: Uint8Array;
    if (an && analyserTime) {
      timeArr = analyserTime;
    } else {
      // Idle / pre-gesture synthetic sine so the wave is never a dead flat line.
      const N = 256;
      const synth = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        synth[i] = 128 + Math.sin(i * 0.12 + phase * 2) * 26 * (playing ? 1 : 0.5);
      }
      timeArr = synth;
    }
    const N = timeArr.length;
    const layers = lite ? 3 : 5;
    ctx2.save();
    ctx2.globalCompositeOperation = 'lighter';
    ctx2.lineCap = 'round';
    ctx2.lineJoin = 'round';
    ctx2.lineWidth = dpr * (lite ? 1.8 : 2.4);
    const layerHex = [accent, accent2, accent, violet, accent2];
    for (let layer = 0; layer < layers; layer++) {
      const off = (layer - (layers - 1) / 2) * h * 0.05;
      const amp = h * (0.14 + beat * 0.1 + bass * 0.08);
      const phaseShift = layer * 0.6;
      const isMain = layer === Math.floor(layers / 2);
      ctx2.beginPath();
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * w;
        const v = (timeArr[i] - 128) / 128;
        const y = cy + off + v * amp + Math.sin(i * 0.05 + phase * 2 + phaseShift) * h * 0.01;
        if (i === 0) ctx2.moveTo(x, y); else ctx2.lineTo(x, y);
      }
      const col = layerHex[layer % layerHex.length];
      ctx2.strokeStyle = hexToRgba(col, isMain ? 0.92 : 0.34);
      if (isMain && !lite) { ctx2.shadowColor = hexToRgba(accent, 0.7); ctx2.shadowBlur = 22 * dpr; }
      else ctx2.shadowBlur = 0;
      ctx2.stroke();
    }
    ctx2.shadowBlur = 0;
    ctx2.restore();
  };
  requestAnimationFrame(tick);
}

function hexToRgba(hex: string, alpha: number): string {
  // Tolerates '#rrggbb', '#rgb', 'rgb(...)', 'rgba(...)'.
  if (hex.startsWith('rgb')) {
    const m = hex.match(/-?\d+(\.\d+)?/g);
    if (m && m.length >= 3) return `rgba(${m[0]}, ${m[1]}, ${m[2]}, ${alpha})`;
    return hex;
  }
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Tick loop + outbound ──────────────────────────────────────────────────
function startTickLoop() {
  setInterval(() => {
    if (pendingState) { broadcast(false); pendingState = false; }
    else broadcast(false); // safety net even if no event fired
  }, 1000 / TICK_HZ);
}

// If no sender hello in 12s after startup, surface idle state. If senders go
// stale (no inbound for 30s), update status indicator.
function startStaleWatcher() {
  if (standaloneMode) return; // no Cast senders to watch in preview mode
  setInterval(() => {
    const senderCount = ctx.getSenders?.()?.length ?? 0;
    if (senderCount === 0) setStatus('stale', 'Awaiting sender…');
    else if (Date.now() - lastSenderHelloAt > 30000) setStatus('stale', 'Sender quiet');
    else setStatus('live', 'Live');
  }, 5000);
}

function broadcast(force = false) {
  const now = Date.now();
  if (!force && now - lastBroadcastAt < 250) return; // throttle to 4Hz max
  lastBroadcastAt = now;
  const cur = currentItem();
  const state: ReceiverState = {
    v: PROTOCOL_VERSION,
    queue: runtime.queue,
    index: runtime.index,
    trackId: cur?.id ?? null,
    playing: playerManager.getPlayerState?.() === 'PLAYING',
    position: playerManager.getCurrentTimeSec?.() ?? 0,
    duration: playerManager.getDurationSec?.() ?? 0,
    volume: playerManager.getCurrentVolume?.()?.level ?? 1,
    muted: !!playerManager.getCurrentVolume?.()?.muted,
    view: runtime.view,
    focusedIndex: runtime.focusedIndex,
    shuffle: runtime.shuffle,
    loop: runtime.loop,
    ts: now,
    protocol: PROTOCOL_VERSION
  };
  send(force ? 'state:full' : 'state:tick', state);
}

function send(type: string, payload: unknown) {
  // Standalone preview or no senders yet: skip the network round-trip
  // entirely. ctx.sendCustomMessage would throw "Cannot read properties of
  // null (reading 'send')" and recursing through logErr→log→send would loop.
  if (standaloneMode) return;
  const senders = (() => { try { return ctx.getSenders?.() ?? []; } catch { return []; } })();
  if (!senders.length) return;
  try {
    const msg: CastMsg<unknown> = { v: PROTOCOL_VERSION, type: type as any, seq: ++outboundSeq, ts: Date.now(), payload };
    ctx.sendCustomMessage(CAST_NAMESPACE, undefined, msg);
  } catch (err) {
    // Use console directly — calling logErr here re-enters send() and loops.
    const m = err instanceof Error ? err.message : String(err);
    console.error('[send:' + type + '] ' + m);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function currentItem(): ReceiverQueueItem | null {
  return runtime.index >= 0 ? runtime.queue[runtime.index] ?? null : null;
}

function safe(fn: () => void) {
  try { fn(); } catch (err) { logErr('safe', err); }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function setText(sel: string, text: string) {
  const el = $(sel);
  if (el && el.textContent !== text) el.textContent = text;
}

function setStatus(kind: 'live' | 'stale' | 'error', text: string) {
  const root = $('#status');
  if (root) root.dataset.status = kind;
  setText('#statusText', text);
  if (kind !== 'error') activeError = null;
}

function showFatal(message: string) {
  document.body.innerHTML = `<div style="display:grid;place-items:center;height:100vh;font:600 24px system-ui;color:#fff;background:#000;text-align:center;padding:8vmin">Receiver fatal: ${escHtml(message)}</div>`;
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function pad2(n: number): string { return n < 10 ? '0' + n : String(n); }

function escHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
}

function escAttr(s: string): string { return escHtml(s).replace(/`/g, ''); }

function getCSS(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function hashId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'auto-' + (h >>> 0).toString(36);
}

function toast(message: string, tone: 'success' | 'error' | 'info' = 'info', durationMs = 2000) {
  const el = $('#toast');
  if (!el) return;
  el.dataset.tone = tone;
  el.textContent = message;
  el.classList.add('is-visible');
  el.setAttribute('aria-hidden', 'false');
  window.clearTimeout((toast as any)._t);
  (toast as any)._t = window.setTimeout(() => {
    el.classList.remove('is-visible');
    el.setAttribute('aria-hidden', 'true');
    // Clear after the fade so `.toast:empty { display:none }` removes the
    // bubble entirely — no empty pill lingering at the bottom of the TV.
    window.setTimeout(() => { if (!el.classList.contains('is-visible')) el.textContent = ''; }, 360);
  }, durationMs);
}

function log(level: 'info' | 'warn' | 'error', tag: string, message: string, data?: unknown) {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${tag}] ${message}`, data ?? '');
  send('log', { level, tag, message, data } as LogPayload);
}

function logErr(tag: string, err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  log('error', tag, m, { stack: err instanceof Error ? err.stack : undefined });
}

function errorOut(code: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  activeError = `${code}: ${message}`;
  setStatus('error', code);
  toast(activeError, 'error', 3000);
  send('state:error', { code, message, recoverable: true });
}
