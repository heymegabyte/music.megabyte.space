// CAF v3 receiver runtime — music.megabyte.space custom receiver (App ID 228565CB).
//
// Lifecycle:
//   1. /cast-receiver/index.html loads cast_receiver_framework.js (gstatic).
//   2. UA sniff (`CrKey/` marker) decides REAL vs STANDALONE preview.
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

interface StandaloneApi {
  standalone: true;
  runtime: RuntimeState;
  audio: HTMLAudioElement | null;
  loadQueue: (items: ReceiverQueueItem[], startIndex?: number) => void;
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
  return {
    addEventListener: (k: string, fn: () => void) => { (listeners[k] ??= []).push(fn); },
    setMessageInterceptor: (_t: any, _fn: any) => { /* no-op in standalone */ },
    load: (req: any) => {
      const url = req?.media?.contentId;
      if (typeof url === 'string' && standaloneAudio) {
        standaloneAudio.src = url;
        const cur = Math.max(0, req?.currentTime ?? 0);
        if (cur) standaloneAudio.currentTime = cur;
        if (req?.autoplay !== false) standaloneAudio.play().catch(() => fire('ERROR'));
      }
    },
    play: () => standaloneAudio?.play().catch(() => { /* user-gesture required first */ }),
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
subscribe(Events.PLAYING, () => { renderUI(); broadcast(); });
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
// can pump messages without a real Cast session.
function exposeStandaloneApi() {
  window.__castReceiver = {
    standalone: true,
    runtime,
    audio: standaloneAudio,
    loadQueue: (items, startIndex = 0) => onQueueLoad({ items, startIndex, autoplay: true }),
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
}

// ─── Sender → receiver dispatch ─────────────────────────────────────────────
function handleSenderMessage(event: any) {
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
  if (p.loop) runtime.loop = p.loop;
  const startIdx = clamp(p.startIndex ?? 0, 0, runtime.queue.length - 1);
  runtime.index = startIdx;
  runtime.focusedIndex = startIdx;
  renderQueue();
  if (p.autoplay !== false) loadAndPlay(runtime.queue[startIdx], p.startPosition ?? 0);
  else renderUI();
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
    runtime.lyricsTrackId = item.id;
    runtime.lyrics = [];
    lastLyricsActiveIdx = -2;
    lastLyricsActiveWordIdx = -2;
    renderLyrics();
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
  const art = $('#artImg') as HTMLImageElement | null;
  if (art && cur.cover && art.src !== cur.cover) {
    art.onerror = () => { logErr('art', new Error('art load failed: ' + cur.cover)); art.src = '/art/cover-panda-desiiignare.png'; };
    art.src = cur.cover;
  }
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
  if (!runtime.lyrics.length) {
    inner.innerHTML = '<p class="lyrics__line is-empty">Lyrics syncing…</p>';
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
}

function updateProgress() {
  const cur = playerManager.getCurrentTimeSec?.() ?? 0;
  const dur = playerManager.getDurationSec?.() ?? 0;
  setText('#now', fmtTime(cur));
  setText('#total', fmtTime(dur));
  const fill = $('#progFill') as HTMLElement | null;
  if (fill) fill.style.width = (dur > 0 ? Math.max(0, Math.min(1, cur / dur)) * 100 : 0).toFixed(1) + '%';
  tickLyrics(cur);
  pendingState = true;
}

function tickLyrics(now: number) {
  if (!runtime.lyrics.length) return;
  let active = -1;
  let lo = 0, hi = runtime.lyrics.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (runtime.lyrics[mid].t <= now) { active = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  const lineChanged = active !== lastLyricsActiveIdx;
  if (lineChanged) {
    if (lastLyricsActiveIdx >= 0) {
      const prevLine = $$('.lyrics__line')[lastLyricsActiveIdx];
      if (prevLine) prevLine.querySelectorAll('.lyrics__w').forEach(s => {
        s.classList.remove('is-active', 'is-past');
      });
    }
    lastLyricsActiveIdx = active;
    lastLyricsActiveWordIdx = -2;
    $$('.lyrics__line').forEach((el, i) => {
      el.classList.toggle('is-active', i === active);
      el.classList.toggle('is-past', i < active);
      el.classList.toggle('is-soon', i === active + 1);
    });
    const target = $$('.lyrics__line')[active];
    const inner = $('#lyricsInner') as HTMLElement | null;
    const wrap = $('#lyrics') as HTMLElement | null;
    if (target && inner && wrap) {
      const wrapH = wrap.clientHeight;
      const offset = (target.offsetTop + target.offsetHeight / 2) - (wrapH / 2);
      inner.style.transform = `translateY(${-offset}px)`;
    }
  }
  if (active < 0) return;
  const line = runtime.lyrics[active];
  const words = line?.words;
  if (!words || !words.length) return;
  let wIdx = -1;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (now >= w.s && now < w.e) { wIdx = i; break; }
    if (now < w.s) { wIdx = i - 1; break; }
  }
  if (wIdx === -1 && now >= words[words.length - 1].e) wIdx = words.length - 1;
  if (wIdx === lastLyricsActiveWordIdx) return;
  lastLyricsActiveWordIdx = wIdx;
  const lineEl = $$('.lyrics__line')[active];
  if (!lineEl) return;
  const wordEls = lineEl.querySelectorAll<HTMLSpanElement>('.lyrics__w');
  wordEls.forEach((s, i) => {
    s.classList.toggle('is-active', i === wIdx);
    s.classList.toggle('is-past', i < wIdx);
  });
}

function applyPalette(p: PalettePayload) {
  const root = document.documentElement.style;
  if (p.bg) {
    // Build 4-stop gradient from a single hex by deriving HSL siblings
    root.setProperty('--bg-a', '#06030f');
    root.setProperty('--bg-b', p.bg);
    root.setProperty('--bg-c', p.muted || p.bg);
    root.setProperty('--bg-d', p.vibrant || p.accent || p.bg);
  }
  if (p.accent) root.setProperty('--accent', p.accent);
  if (p.vibrant) root.setProperty('--vibrant', p.vibrant);
  if (p.muted) root.setProperty('--muted', p.muted);
  if (p.ink) root.setProperty('--ink', p.ink);
}

function applyLyrics(p: LyricsPayload) {
  if (!p?.trackId) return;
  if (p.trackId !== currentItem()?.id) {
    runtime.lyricsTrackId = p.trackId;
  }
  runtime.lyrics = (p.lines ?? []).slice().sort((a, b) => a.t - b.t);
  lastLyricsActiveIdx = -2;
  lastLyricsActiveWordIdx = -2;
  renderLyrics();
}

function setView(view: ReceiverView | 'idle') {
  runtime.view = (view === 'idle' ? 'now-playing' : view);
  const stage = $('#stage') as HTMLElement | null;
  if (stage) stage.dataset.view = view;
}

function scrollFocusedIntoView() {
  const list = $('#queueList');
  if (!list) return;
  const target = list.querySelector('.queue__item.is-focused') as HTMLElement | null;
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ─── D-pad keyboard ────────────────────────────────────────────────────────
function setupKeyboard() {
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
function startVisualizer() {
  const canvas = $('#viz') as HTMLCanvasElement | null;
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
  };
  resize();
  window.addEventListener('resize', resize);
  const ctx2 = canvas.getContext('2d', { alpha: true });
  if (!ctx2) return;
  let t0 = performance.now();
  let raf = 0;
  const tick = (t: number) => {
    raf = requestAnimationFrame(tick);
    const dt = (t - t0) / 1000;
    t0 = t;
    if (document.hidden) return;
    const w = canvas.width, h = canvas.height;
    ctx2.clearRect(0, 0, w, h);
    const playing = playerManager.getPlayerState?.() === 'PLAYING';
    if (!playing) return;
    const accent = getCSS('--accent') || '#00e5ff';
    const vibrant = getCSS('--vibrant') || '#ff4ab6';
    const phase = (t / 1000) * 1.2;
    const bars = 64;
    const bw = w / bars;
    for (let i = 0; i < bars; i++) {
      const f = (Math.sin(phase + i * 0.18) + 1) / 2;
      const energy = 0.5 + 0.5 * Math.sin(phase * 1.5 + i * 0.31);
      const bh = h * 0.18 * (0.4 + 0.6 * f * energy);
      const grad = ctx2.createLinearGradient(0, h - bh, 0, h);
      grad.addColorStop(0, vibrant);
      grad.addColorStop(1, accent);
      ctx2.fillStyle = grad;
      ctx2.fillRect(i * bw + 1, h - bh, bw - 2, bh);
    }
    void dt;
  };
  raf = requestAnimationFrame(tick);
  void raf;
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
