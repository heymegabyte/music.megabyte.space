import './style.css';
import { AudioEngine } from './audio';
import type { ReverbPreset } from './audio';
import { Visualizer } from './visualizer';
import type { VizMode } from './visualizer';
import { ALBUMS, ALBUM_BY_ID, TRACKS, TRACK_BY_ID, SPOTIFY_ARTIST_ID } from './data';
import { TRACK_TAGS, getTrackTags } from './tags';
import type { Track, Album } from './types';
import { cast } from './cast';
import type { ReceiverQueueItem, ReceiverLine, ReceiverState, PalettePayload } from './cast-protocol';
import { extractPalette, type Palette } from './palette';
interface CastWord { w: string; s: number; e: number; }
interface CastLine { t: number; e: number; text: string; words: CastWord[]; }
import { hue, type HueGroup } from './hue';
import {
  airplayAvailable,
  showAirPlayPicker,
  acquireWakeLock,
  releaseWakeLock,
  openSmartLink,
  setMediaSessionPosition,
  setMediaSessionPlaybackState
} from './media-integrations';
import { nativeShareSupported, shareWithFallback } from './web-share';
import { pushSupported, pushState, subscribePush, unsubscribePush } from './web-push';
import { createPipController, type PipController } from './pip';
import { mountSpotifyConnect, handleAuthCallback as handleSpotifyCallback } from './spotify-connect';
import { mountAIChat } from './ai-chat';

const $ = <T extends HTMLElement>(sel: string, root: Document | HTMLElement = document) =>
  root.querySelector(sel) as T | null;

interface WhisperWord { w: string; s: number; e: number; line?: number; }
interface WhisperLine { s: number; e: number; text: string; }
type LyricsSource = 'whisper' | 'aligned' | 'estimated' | 'estimated-words';
interface LyricsBundle { words?: WhisperWord[]; lines: WhisperLine[]; duration?: number; source: LyricsSource; }

const engine = new AudioEngine();
let visualizer: Visualizer;
let currentTrackId: string | null = null;
let pipController: PipController | null = null;
let hudRaf: number | null = null;
let lyricsRaf: number | null = null;
const lyricsCache = new Map<string, LyricsBundle | null>();
let activeLyrics: LyricsBundle | null = null;
let lyricsRenderedBundle: LyricsBundle | null = null;
let lyricsLineEls: HTMLParagraphElement[] = [];
let lyricsCurLineWords: WhisperWord[] = [];
let lyricsCurWordSpans: HTMLSpanElement[] = [];
let lyricsLastLineIdx = -2;
let lyricsLastWordIdx = -2;
let lyricsLastScrollIdx = -2;
let lyricsClickBound = false;
let currentAlbumFilter: string | null = null;
let autoplayPromptTrack: Track | null = null;
let shuffleOn = false;
let searchOpen = false;
let searchActiveIdx = 0;
let npPanelOpen = false;
let activeReverb: ReverbPreset = 'room';
let wisdomTimer: ReturnType<typeof setTimeout> | null = null;

type LoopMode = 'off' | 'one' | 'all';
let loopMode: LoopMode = 'off';
let recentTracks: string[] = [];
let playCounts = new Map<string, number>();
let shareCounts = new Map<string, number>();
const playReported = new Set<string>();
let statsLoaded = false;
let sleepTimerHandle: ReturnType<typeof setTimeout> | null = null;
let sleepTimerEndAt = 0;
let sleepTickHandle: ReturnType<typeof setInterval> | null = null;
let lyricsFsOpen = false;
let karaokeOverlayOn = (() => { try { return localStorage.getItem('bz:karaoke:overlay') === '1'; } catch { return false; } })();
let karaokeLastIdx = -2;
let karaokeOverlayWords: WhisperWord[] = [];
let karaokeOverlayWordSpans: HTMLSpanElement[] = [];
let karaokeOverlayWordIdx = -2;
let queuePanelOpen = false;
let shortcutsOpen = false;
let pendingDeeplinkSeek: number | null = null;
let installPromptEvent: Event | null = null;
let crossfadeEnabled = false;

const LS_KEYS = {
  recents: 'bz:recents',
  loop: 'bz:loop',
  shuffle: 'bz:shuffle',
  vol: 'bz:vol',
  eq: 'bz:eq',
  reverb: 'bz:reverb',
  visits: 'bz:visits',
  installDismissed: 'bz:installDismissed',
  installSnoozeUntil: 'bz:installSnoozeUntil',
  crossfade: 'bz:crossfade',
  listenStats: 'bz:listenStats'
};

interface LocalListenStat {
  starts: number;
  completes: number;
  skips: number;
  replays: number;
  secondsListened: number;
  lastPlayAt: number;
}
const listenStats = new Map<string, LocalListenStat>();
let lastPlayedAt: { id: string; startedAt: number; lastTime: number; counted: boolean } | null = null;

const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function loadPersisted() {
  try {
    const r = localStorage.getItem(LS_KEYS.recents);
    if (r) recentTracks = JSON.parse(r) as string[];
    const l = localStorage.getItem(LS_KEYS.loop) as LoopMode | null;
    if (l && (l === 'off' || l === 'one' || l === 'all')) loopMode = l;
    const s = localStorage.getItem(LS_KEYS.shuffle);
    if (s === '1') shuffleOn = true;
    const cf = localStorage.getItem(LS_KEYS.crossfade);
    if (cf === '1') crossfadeEnabled = true;
    const ls = localStorage.getItem(LS_KEYS.listenStats);
    if (ls) {
      const parsed = JSON.parse(ls) as Record<string, LocalListenStat>;
      for (const [id, v] of Object.entries(parsed)) {
        if (v && typeof v.starts === 'number') listenStats.set(id, v);
      }
    }
  } catch { /* noop */ }
}

function getListenStat(id: string): LocalListenStat {
  let s = listenStats.get(id);
  if (!s) {
    s = { starts: 0, completes: 0, skips: 0, replays: 0, secondsListened: 0, lastPlayAt: 0 };
    listenStats.set(id, s);
  }
  return s;
}

function persistListenStats() {
  const out: Record<string, LocalListenStat> = {};
  for (const [id, v] of listenStats) out[id] = v;
  persist(LS_KEYS.listenStats, out);
}

function closePriorListenSession() {
  if (!lastPlayedAt) return;
  const prior = lastPlayedAt;
  const stat = getListenStat(prior.id);
  const duration = TRACK_BY_ID.get(prior.id)
    ? (engine.audio?.duration && Number.isFinite(engine.audio.duration) ? engine.audio.duration : 0)
    : 0;
  const fraction = duration > 0 ? prior.lastTime / duration : 0;
  if (!prior.counted) {
    if (fraction >= 0.9) stat.completes += 1;
    else if (fraction < 0.25 && prior.lastTime < 30) stat.skips += 1;
  }
  lastPlayedAt = null;
  persistListenStats();
}

function recordPlayStart(trackId: string) {
  if (lastPlayedAt && lastPlayedAt.id !== trackId) closePriorListenSession();
  const stat = getListenStat(trackId);
  if (lastPlayedAt?.id === trackId) {
    stat.replays += 1;
  } else {
    stat.starts += 1;
  }
  stat.lastPlayAt = Date.now();
  lastPlayedAt = { id: trackId, startedAt: Date.now(), lastTime: 0, counted: false };
  persistListenStats();
}

function recordListenProgress(currentTime: number) {
  if (!lastPlayedAt) return;
  lastPlayedAt.lastTime = currentTime;
  const dur = engine.audio?.duration;
  if (!lastPlayedAt.counted && dur && Number.isFinite(dur) && currentTime / dur >= 0.9) {
    lastPlayedAt.counted = true;
    const stat = getListenStat(lastPlayedAt.id);
    stat.completes += 1;
    persistListenStats();
  }
}

function recordTrackEnded() {
  if (!lastPlayedAt) return;
  const stat = getListenStat(lastPlayedAt.id);
  if (!lastPlayedAt.counted) {
    stat.completes += 1;
    lastPlayedAt.counted = true;
  }
  persistListenStats();
}

async function loadGlobalStats() {
  try {
    const res = await fetch('/api/stats', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json() as { tracks?: Record<string, { plays?: number; shares?: number }> };
    if (data.tracks) {
      for (const [id, c] of Object.entries(data.tracks)) {
        if (typeof c.plays === 'number') playCounts.set(id, c.plays);
        if (typeof c.shares === 'number') shareCounts.set(id, c.shares);
      }
    }
    statsLoaded = true;
    document.querySelectorAll<HTMLElement>('[data-plays]').forEach(el => {
      const id = el.dataset.plays!;
      const n = playCounts.get(id) ?? 0;
      el.hidden = n === 0;
      const num = el.querySelector('[data-plays-num]');
      if (num) num.textContent = String(n);
    });
    refreshShareLabel();
  } catch { /* noop */ }
}

function persist(key: string, value: unknown) {
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); }
  catch { /* noop */ }
}

function persistRecents() { persist(LS_KEYS.recents, recentTracks); }

function trackRecent(trackId: string) {
  recentTracks = [trackId, ...recentTracks.filter(id => id !== trackId)].slice(0, 12);
  persistRecents();
}

async function reportPlay(trackId: string) {
  if (playReported.has(trackId)) return;
  playReported.add(trackId);
  try {
    const res = await fetch(`/api/play/${encodeURIComponent(trackId)}`, { method: 'POST', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json() as { plays?: number };
      if (typeof data.plays === 'number') {
        playCounts.set(trackId, data.plays);
        refreshTrackStats(trackId);
      }
    }
  } catch { /* noop */ }
}

async function reportShare(trackId: string) {
  try {
    const res = await fetch(`/api/share/${encodeURIComponent(trackId)}`, { method: 'POST', cache: 'no-store' });
    if (res.ok) {
      const data = await res.json() as { shares?: number };
      if (typeof data.shares === 'number') {
        shareCounts.set(trackId, data.shares);
        refreshTrackStats(trackId);
      }
    }
  } catch { /* noop */ }
}

function refreshTrackStats(trackId: string) {
  const plays = playCounts.get(trackId) ?? 0;
  document.querySelectorAll<HTMLElement>(`[data-plays="${trackId}"]`).forEach(el => {
    el.hidden = plays === 0;
    const num = el.querySelector('[data-plays-num]');
    if (num) num.textContent = String(plays);
  });
  if (trackId === currentTrackId) refreshShareLabel();
}

interface AiPickScore {
  trackId: string;
  score: number;
  parts: { global: number; completion: number; local: number; shares: number; recency: number };
}

function aiPicks(limit = 5): AiPickScore[] {
  const maxGlobal = Math.max(1, ...Array.from(playCounts.values()));
  const maxShares = Math.max(1, ...Array.from(shareCounts.values()));
  const maxLocal = Math.max(1, ...Array.from(listenStats.values()).map(s => s.starts + s.replays));
  const now = Date.now();
  const RECENCY_HALF_LIFE = 7 * 24 * 60 * 60 * 1000;

  const scored: AiPickScore[] = TRACKS.map(t => {
    const gp = playCounts.get(t.id) ?? 0;
    const sh = shareCounts.get(t.id) ?? 0;
    const ls = listenStats.get(t.id);
    const localPlays = ls ? ls.starts + ls.replays : 0;
    const completion = ls && ls.starts > 0 ? ls.completes / ls.starts : 0;
    const recencyMs = ls?.lastPlayAt ? now - ls.lastPlayAt : Number.POSITIVE_INFINITY;
    const recency = Number.isFinite(recencyMs) ? Math.exp(-recencyMs / RECENCY_HALF_LIFE) : 0;
    const globalNorm = gp / maxGlobal;
    const sharesNorm = sh / maxShares;
    const localNorm = localPlays / maxLocal;
    const score =
      globalNorm * 0.40 +
      completion * 0.20 +
      localNorm * 0.15 +
      sharesNorm * 0.15 +
      recency * 0.10;
    return { trackId: t.id, score, parts: { global: globalNorm, completion, local: localNorm, shares: sharesNorm, recency } };
  });

  if (scored.every(s => s.score === 0)) {
    return TRACKS.slice(0, limit).map((t, i) => ({
      trackId: t.id,
      score: 1 - i * 0.05,
      parts: { global: 0, completion: 0, local: 0, shares: 0, recency: 0 }
    }));
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function refreshAiPlaylist() {
  const wrap = document.getElementById('aiPlaylistWrap');
  const host = document.getElementById('aiPlaylist');
  if (!host) return;
  const picks = aiPicks(5);
  if (!picks.length) {
    host.innerHTML = '';
    wrap?.classList.remove('is-ready');
    return;
  }
  const html = picks.map((pick, idx) => {
    const t = TRACK_BY_ID.get(pick.trackId);
    if (!t) return '';
    const album = ALBUM_BY_ID.get(t.album);
    const isCurrent = pick.trackId === currentTrackId;
    const pct = Math.round(pick.score * 100);
    return `<button type="button" class="ai-pick${isCurrent ? ' is-current' : ''}" data-ai-pick="${pick.trackId}" style="--ai-pick-score:${pick.score.toFixed(3)}" aria-label="Play ${t.title} from ${album?.name ?? 'bZ'} — AI pick #${idx + 1}, score ${pct}">
      <span class="ai-pick__rank" aria-hidden="true">${idx + 1}</span>
      <img class="ai-pick__cover" src="${album?.cover ?? '/art/cover-panda-desiiignare.png'}" alt="" width="38" height="38" loading="lazy" />
      <span class="ai-pick__meta">
        <span class="ai-pick__title">${t.title}</span>
        <span class="ai-pick__album">${album?.name ?? 'bZ'}</span>
      </span>
      <span class="ai-pick__score" aria-hidden="true">${pct}</span>
    </button>`;
  }).join('');
  host.innerHTML = html;
  wrap?.classList.add('is-ready');
}

function bindAiPlaylist() {
  const host = document.getElementById('aiPlaylist');
  if (!host || host.dataset.bound === '1') return;
  host.dataset.bound = '1';
  host.addEventListener('click', e => {
    const btn = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-ai-pick]');
    if (!btn) return;
    const id = btn.dataset.aiPick;
    if (!id) return;
    const t = TRACK_BY_ID.get(id);
    if (t) play(t);
  });
}

function refreshShareLabel() {
  const label = document.getElementById('btnShareLabel');
  const btn = document.getElementById('btnShare');
  if (!label) return;
  const n = currentTrackId ? (shareCounts.get(currentTrackId) ?? 0) : 0;
  if (!currentTrackId || n === 0) {
    label.textContent = '';
    label.setAttribute('hidden', '');
    if (btn) btn.setAttribute('aria-label', 'Share now playing');
  } else {
    label.textContent = String(n);
    label.removeAttribute('hidden');
    if (btn) btn.setAttribute('aria-label', `Share now playing — ${n} ${n === 1 ? 'share' : 'shares'}`);
  }
}

function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
function fmtHz(hz: number) {
  if (!Number.isFinite(hz) || hz <= 0) return '— Hz';
  if (hz >= 1000) return `${(hz / 1000).toFixed(2)} kHz`;
  return `${Math.round(hz)} Hz`;
}

const VIZ_GROUPS: Array<{ label: string; tagline: string; modes: VizMode[] }> = [
  { label: 'Cosmos',   tagline: 'Stars, galaxies, deep space',  modes: ['starfield', 'constellation', 'galaxy', 'supernova', 'aurora', 'nebula'] },
  { label: 'Love',     tagline: 'For Laura, Adrian, CK',         modes: ['petals', 'rose'] },
  { label: 'Energy',   tagline: 'Plasma, drops, prisms',         modes: ['plasma', 'drop-strobe', 'prism', 'sunburst'] },
  { label: 'Geometry', tagline: 'Sacred shapes + lattices',      modes: ['mandala', 'lattice', 'hex-grid', 'lissajous', 'rings', 'cymatics'] },
  { label: 'Organic',  tagline: 'Particles + fluid',             modes: ['fireflies', 'bokeh', 'liquid', 'smoke', 'ribbons'] },
  { label: 'Spectrum', tagline: 'Bars, waves, waterfalls',       modes: ['bars', 'wave', 'waterfall', 'mirror-wave', 'strings', 'monolith'] },
  { label: 'Retro',    tagline: 'Vinyl spin',                    modes: ['vinyl'] },
  { label: 'Spatial',  tagline: 'Tunnels + kaleidoscopes',       modes: ['composite', 'tunnel', 'kaleidoscope', 'wormhole', 'vortex'] },
  { label: 'Field',    tagline: 'Bloom, flux, orbits',           modes: ['bloom', 'flux', 'gravity', 'spider', 'palette-orbs', 'confetti'] },
];

function buildVizPicker(grid: HTMLElement | null, catalog: VizMode[], current: VizMode) {
  if (!grid) return;
  const seen = new Set<string>();
  let html = '';
  for (const g of VIZ_GROUPS) {
    const groupModes = g.modes.filter(m => catalog.includes(m));
    if (groupModes.length === 0) continue;
    html += `<section class="viz-picker__group" data-viz-group="${g.label.toLowerCase()}">
      <header class="viz-picker__group-h">
        <span class="viz-picker__group-name">${g.label}</span>
        <span class="viz-picker__group-tag">${g.tagline}</span>
      </header>
      <div class="viz-picker__chips">`;
    for (const m of groupModes) {
      seen.add(m);
      const active = m === current ? ' is-active' : '';
      html += `<button type="button" role="option" class="viz-chip${active}" data-viz-slug="${m}" data-viz-name="${m}" aria-selected="${m === current}">
        <span class="viz-chip__dot" aria-hidden="true"></span>
        <span class="viz-chip__name">${m}</span>
      </button>`;
    }
    html += `</div></section>`;
  }
  // Catch any modes not assigned to a group — render under "More"
  const orphans = catalog.filter(m => !seen.has(m));
  if (orphans.length) {
    html += `<section class="viz-picker__group" data-viz-group="more">
      <header class="viz-picker__group-h">
        <span class="viz-picker__group-name">More</span>
        <span class="viz-picker__group-tag">Additional modes</span>
      </header>
      <div class="viz-picker__chips">`;
    for (const m of orphans) {
      const active = m === current ? ' is-active' : '';
      html += `<button type="button" role="option" class="viz-chip${active}" data-viz-slug="${m}" data-viz-name="${m}" aria-selected="${m === current}">
        <span class="viz-chip__dot" aria-hidden="true"></span>
        <span class="viz-chip__name">${m}</span>
      </button>`;
    }
    html += `</div></section>`;
  }
  grid.innerHTML = html;
}

function markActiveVizChip(grid: HTMLElement | null, mode: VizMode) {
  if (!grid) return;
  grid.querySelectorAll<HTMLButtonElement>('[data-viz-slug]').forEach(btn => {
    const on = btn.dataset.vizSlug === mode;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function filterVizGrid(grid: HTMLElement | null, q: string) {
  if (!grid) return;
  const needle = q.trim().toLowerCase();
  let groupHits = 0;
  grid.querySelectorAll<HTMLElement>('.viz-picker__group').forEach(group => {
    let visible = 0;
    group.querySelectorAll<HTMLButtonElement>('[data-viz-slug]').forEach(chip => {
      const match = !needle || chip.dataset.vizName!.includes(needle);
      chip.hidden = !match;
      if (match) visible++;
    });
    group.hidden = visible === 0;
    if (visible > 0) groupHits++;
  });
  grid.dataset.empty = groupHits === 0 ? '1' : '';
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
function hzToNote(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 20) return '—';
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const oct = Math.floor(midi / 12) - 1;
  return `${name}${oct}`;
}

function fmtClock(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function trackPath(track: Track) { return `/${track.album}/${track.id}`; }
function albumPath(albumId: string) { return `/${albumId}`; }

type RouteMatch =
  | { kind: 'track'; trackId: string }
  | { kind: 'album'; albumId: string }
  | null;

function parseRouteFromUrl(pathname: string = location.pathname): RouteMatch {
  const legacy = pathname.match(/^\/track\/([a-z0-9-]+)\/?$/i);
  if (legacy) return { kind: 'track', trackId: legacy[1] };
  const two = pathname.match(/^\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/i);
  if (two) {
    const [, albumSlug, trackSlug] = two;
    if (albumSlug === 'ashton') return null;
    if (ALBUM_BY_ID.has(albumSlug) && TRACK_BY_ID.has(trackSlug)) {
      const t = TRACK_BY_ID.get(trackSlug)!;
      if (t.album === albumSlug) return { kind: 'track', trackId: trackSlug };
    }
    return null;
  }
  const one = pathname.match(/^\/([a-z0-9-]+)\/?$/i);
  if (one) {
    const [, slug] = one;
    if (slug === 'ashton') return null;
    if (ALBUM_BY_ID.has(slug)) return { kind: 'album', albumId: slug };
  }
  return null;
}

const SITE_ORIGIN = 'https://music.megabyte.space';
const DEFAULT_OG = `${SITE_ORIGIN}/og/album-desiiignare.jpg`;

function setMeta(selector: string, attr: 'content' | 'href', value: string) {
  const el = document.head.querySelector(selector);
  if (el) el.setAttribute(attr, value);
}

function trackOgUrl(trackId: string) {
  return `${SITE_ORIGIN}/og/track-${trackId}.jpg`;
}

function albumOgUrl(albumId: string) {
  return `${SITE_ORIGIN}/og/album-${albumId}.jpg`;
}

function applyTrackMetadata(track: Track) {
  const album = ALBUM_BY_ID.get(track.album);
  const albumName = album?.name ?? 'bZ';
  const title = `${track.title} — bZ`;
  const desc = `${track.title}: ${track.vibe}. From ${albumName} by bZ. Live Web Audio visualizer + karaoke.`;
  const url = `${SITE_ORIGIN}${trackPath(track)}`;
  const og = trackOgUrl(track.id);
  document.title = title;
  setMeta('meta[name="description"]', 'content', desc);
  setMeta('link[rel="canonical"]', 'href', url);
  setMeta('meta[property="og:title"]', 'content', title);
  setMeta('meta[property="og:description"]', 'content', desc);
  setMeta('meta[property="og:url"]', 'content', url);
  setMeta('meta[property="og:image"]', 'content', og);
  setMeta('meta[property="og:image:secure_url"]', 'content', og);
  setMeta('meta[property="og:image:type"]', 'content', 'image/jpeg');
  setMeta('meta[property="og:image:width"]', 'content', '1200');
  setMeta('meta[property="og:image:height"]', 'content', '630');
  setMeta('meta[property="og:image:alt"]', 'content', `${track.title} — branded card`);
  setMeta('meta[name="twitter:title"]', 'content', title);
  setMeta('meta[name="twitter:description"]', 'content', desc);
  setMeta('meta[name="twitter:image"]', 'content', og);
  setMeta('meta[name="twitter:image:alt"]', 'content', `${track.title} — branded card`);
  setMeta('meta[name="theme-color"]', 'content', album?.accent ?? '#060610');
}

function applyAlbumMetadata(albumId: string) {
  const album = ALBUM_BY_ID.get(albumId);
  if (!album) return;
  const title = `${album.name} — bZ`;
  const desc = `${album.name}: ${album.tagline}. ${album.description}`.slice(0, 200);
  const url = `${SITE_ORIGIN}${albumPath(albumId)}`;
  const og = albumOgUrl(albumId);
  document.title = title;
  setMeta('meta[name="description"]', 'content', desc);
  setMeta('link[rel="canonical"]', 'href', url);
  setMeta('meta[property="og:title"]', 'content', title);
  setMeta('meta[property="og:description"]', 'content', desc);
  setMeta('meta[property="og:url"]', 'content', url);
  setMeta('meta[property="og:image"]', 'content', og);
  setMeta('meta[property="og:image:secure_url"]', 'content', og);
  setMeta('meta[property="og:image:type"]', 'content', 'image/jpeg');
  setMeta('meta[name="twitter:title"]', 'content', title);
  setMeta('meta[name="twitter:description"]', 'content', desc);
  setMeta('meta[name="twitter:image"]', 'content', og);
  setMeta('meta[name="theme-color"]', 'content', album.accent);
}

function applyDefaultMetadata() {
  document.title = 'bZ — live Web Audio gospel';
  setMeta('link[rel="canonical"]', 'href', `${SITE_ORIGIN}/`);
  setMeta('meta[property="og:url"]', 'content', `${SITE_ORIGIN}/`);
  setMeta('meta[property="og:image"]', 'content', DEFAULT_OG);
  setMeta('meta[property="og:image:secure_url"]', 'content', DEFAULT_OG);
}

function pushTrackUrl(track: Track) {
  const url = trackPath(track);
  if (location.pathname !== url) history.pushState({ trackId: track.id }, '', url);
  applyTrackMetadata(track);
}

function scrollToAlbum(albumId: string) {
  const el = document.querySelector(`[data-album="${albumId}"]`) as HTMLElement | null;
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function scrollToTrack(trackId: string) {
  const el = document.querySelector(`[data-track="${trackId}"]`) as HTMLElement | null;
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function setAlbumFilter(albumId: string | null, opts: { push?: boolean; render?: boolean } = {}) {
  const { push = false, render = true } = opts;
  currentAlbumFilter = albumId;
  if (push) {
    const url = albumId ? albumPath(albumId) : '/';
    if (location.pathname !== url) history.pushState({ albumId }, '', url);
  }
  if (albumId) applyAlbumMetadata(albumId); else applyDefaultMetadata();
  if (render) {
    const host = $('#albums');
    if (host) renderAlbums(host);
  }
}

function showAutoplayPrompt(track: Track) {
  autoplayPromptTrack = track;
  const dialog = $('#autoplayPrompt') as HTMLDialogElement | null;
  const cover = $('#apCover') as HTMLImageElement | null;
  const title = $('#apTitle');
  const meta = $('#apMeta');
  const album = ALBUM_BY_ID.get(track.album);
  if (cover) cover.src = album?.cover ?? track.cover;
  if (title) title.textContent = track.title;
  if (meta) meta.textContent = `${album?.name ?? 'bZ'} · ${track.vibe}`;
  if (dialog && !dialog.open) dialog.showModal();
  document.documentElement.classList.add('is-autoplay-prompt');
}

function dismissAutoplayPrompt() {
  const dialog = $('#autoplayPrompt') as HTMLDialogElement | null;
  if (dialog?.open) dialog.close();
  autoplayPromptTrack = null;
  document.documentElement.classList.remove('is-autoplay-prompt');
}

interface ShareTarget {
  kind: 'track' | 'album';
  id: string;
  title: string;
  sub: string;
  cover: string;
  shareUrl: string;
  embedPath: string;
}
type EmbedSize = 'small' | 'medium' | 'wide';
const EMBED_DIMS: Record<EmbedSize, { w: string; h: number }> = {
  small: { w: '320', h: 180 },
  medium: { w: '480', h: 220 },
  wide: { w: '100%', h: 220 }
};
let shareCurrent: ShareTarget | null = null;
let shareEmbedSize: EmbedSize = 'small';

function buildShareTarget(kind: 'track' | 'album', id: string): ShareTarget | null {
  if (kind === 'track') {
    const t = TRACK_BY_ID.get(id);
    if (!t) return null;
    const album = ALBUM_BY_ID.get(t.album);
    return {
      kind, id: t.id,
      title: t.title,
      sub: `${album?.name ?? 'bZ'} · bZ`,
      cover: album?.cover ?? '/art/cover-panda-desiiignare.png',
      shareUrl: `${SITE_ORIGIN}${trackPath(t)}`,
      embedPath: `/embed/${t.album}/${t.id}`
    };
  }
  const a = ALBUM_BY_ID.get(id);
  if (!a) return null;
  return {
    kind, id: a.id,
    title: a.name,
    sub: `${a.trackIds.length} tracks · bZ`,
    cover: a.cover,
    shareUrl: `${SITE_ORIGIN}${albumPath(a.id)}`,
    embedPath: `/embed/${a.id}`
  };
}

function embedSnippet(target: ShareTarget, size: EmbedSize): string {
  const { w, h } = EMBED_DIMS[size];
  const widthAttr = w === '100%' ? 'width="100%"' : `width="${w}"`;
  const styleExtra = w === '100%' ? ' style="max-width:560px;width:100%;"' : '';
  const src = `${SITE_ORIGIN}${target.embedPath}`;
  return `<iframe src="${src}" ${widthAttr} height="${h}" frameborder="0" allow="autoplay; clipboard-write; encrypted-media" loading="lazy" title="bZ — ${target.title}"${styleExtra}></iframe>`;
}

function refreshShareDialog() {
  if (!shareCurrent) return;
  const t = shareCurrent;
  const cover = $('#shareCover') as HTMLImageElement | null;
  if (cover) { cover.src = t.cover; cover.alt = `${t.title} cover`; }
  const titleEl = $('#shareTitle');
  if (titleEl) titleEl.textContent = t.title;
  const subEl = $('#shareSub');
  if (subEl) subEl.textContent = t.sub;
  const eyebrow = $('#shareEyebrow');
  if (eyebrow) eyebrow.textContent = t.kind === 'track' ? 'share song' : 'share album';
  const link = $('#shareLink') as HTMLInputElement | null;
  if (link) link.value = t.shareUrl;
  const tweet = $('#shareTweet') as HTMLAnchorElement | null;
  if (tweet) {
    const text = `${t.title} — bZ`;
    tweet.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(t.shareUrl)}`;
  }
  const mail = $('#shareEmail') as HTMLAnchorElement | null;
  if (mail) {
    mail.href = `mailto:?subject=${encodeURIComponent(`bZ — ${t.title}`)}&body=${encodeURIComponent(`${t.title} — listen here:\n${t.shareUrl}`)}`;
  }
  const code = $('#shareEmbedCode') as HTMLTextAreaElement | null;
  if (code) code.value = embedSnippet(t, shareEmbedSize);
  const preview = $('#shareEmbedPreview') as HTMLAnchorElement | null;
  if (preview) preview.href = `${SITE_ORIGIN}${t.embedPath}`;
  const native = $('#shareNative') as HTMLButtonElement | null;
  if (native) native.hidden = !nativeShareSupported();
}

function openShare(kind: 'track' | 'album', id: string) {
  const t = buildShareTarget(kind, id);
  if (!t) return;
  shareCurrent = t;
  refreshShareDialog();
  const dialog = $('#share') as HTMLDialogElement | null;
  if (dialog && !dialog.open) dialog.showModal();
  if (kind === 'track') reportShare(id);
}

function closeShare() {
  const dialog = $('#share') as HTMLDialogElement | null;
  if (dialog?.open) dialog.close();
  shareCurrent = null;
}

async function copyText(value: string, btn?: HTMLElement | null) {
  try {
    await navigator.clipboard.writeText(value);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => { if (btn.textContent === 'Copied ✓') btn.textContent = prev ?? ''; }, 1400);
    }
  } catch {
    const input = document.createElement('textarea');
    input.value = value; document.body.appendChild(input); input.select();
    try { document.execCommand('copy'); } catch { /* noop */ }
    input.remove();
  }
}

function setupShell(root: HTMLElement) {
  root.innerHTML = `
    <canvas id="bg" aria-hidden="true"></canvas>

    <header class="topbar">
      <a class="brand" href="/" aria-label="bZ home">
        <span class="brand__text">bZ</span>
      </a>
      <div class="topbar__title" aria-hidden="true">
        <span class="topbar__title-mute">now playing —</span>
        <span class="topbar__title-text" id="npChrome">press play</span>
      </div>
      <nav class="topbar__nav" aria-label="Site">
        <button id="btnSearch" class="topbar__search" type="button" aria-label="Search tracks (⌘K)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
        <button id="btnLyricsOverlay" class="topbar__lyrics" type="button" aria-label="Toggle live lyrics overlay" aria-pressed="false" title="Live lyrics overlay (Shift+L)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span>Lyrics</span>
        </button>
        <a id="lnkAppeal" href="/ashton/">appeal</a>
        <a href="https://mission.megabyte.space" target="_blank" rel="noopener noreferrer">mission</a>
      </nav>
    </header>

    <main class="zune" id="zune">
      <aside class="rail" aria-label="Albums">
        <div class="albums" id="albums"></div>
      </aside>

      <section class="viz" aria-label="Live audio visualizer">
        <div class="viz__hero">
          <span class="viz__hero-album" id="heroAlbum">BZ · CYAN FLAG</span>
          <h1 class="viz__hero-title" id="heroTitle">PRESS PLAY</h1>
          <p class="viz__hero-vibe" id="heroVibe">Web Audio API live. Hard but holy.</p>
          <div class="viz__hero-tags" id="heroTags" aria-label="Track tags" hidden></div>
        </div>

        <div class="hud" id="hud" aria-live="polite">
          <span class="hud__cell"><span class="hud__k">BPM</span><span class="hud__v" id="hudBpm">—</span></span>
          <span class="hud__cell"><span class="hud__k">KEY</span><span class="hud__v" id="hudKey">—</span></span>
          <span class="hud__cell"><span class="hud__k">PK</span><span class="hud__v" id="hudPeak">— Hz</span></span>
          <span class="hud__cell"><span class="hud__k">T</span><span class="hud__v hud__v--time" id="hudTime">0:00 / 0:00</span></span>
          <span class="hud__cell"><span class="hud__k">FPS</span><span class="hud__v" id="hudFps">60</span></span>
          <span class="hud__cell hud__cell--meter">
            <span class="hud__k">L·R</span>
            <span class="hud__vu-stack">
              <i class="hud__vu"><i class="hud__vu-bar" id="vuL"></i></i>
              <i class="hud__vu"><i class="hud__vu-bar" id="vuR"></i></i>
            </span>
          </span>
          <span class="hud__cell hud__cell--meter">
            <span class="hud__k">B·M·T</span>
            <span class="hud__bands">
              <i class="hud__band" id="bandBass"></i>
              <i class="hud__band" id="bandMid"></i>
              <i class="hud__band" id="bandTreb"></i>
            </span>
          </span>
          <button class="hud__mode-btn" id="modeBtn" type="button" popovertarget="vizPicker" aria-haspopup="dialog" aria-expanded="false" aria-label="Pick visualizer mode — 50 available" title="50 visualizer modes (V to cycle, or click to browse)">
            <span class="hud__mode-count" id="modeBtnCount" aria-hidden="true">50</span>
            <span class="hud__mode-name" id="modeBtnLabel">composite</span>
            <span class="hud__mode-chev" aria-hidden="true">▾</span>
          </button>
        </div>

        <div id="vizPicker" popover="auto" class="viz-picker" role="dialog" aria-label="Pick a visualizer mode">
          <header class="viz-picker__header">
            <div class="viz-picker__title-block">
              <span class="viz-picker__eyebrow">Visualizer</span>
              <h2 class="viz-picker__title" id="vizPickerTitle">50 modes</h2>
            </div>
            <label class="viz-picker__cycle" title="Beat-synced random cycling">
              <input type="checkbox" id="vizAutoCycle" checked />
              <span class="viz-picker__cycle-dot" aria-hidden="true"></span>
              <span class="viz-picker__cycle-label">Auto-cycle</span>
            </label>
            <button class="viz-picker__close" type="button" popovertarget="vizPicker" popovertargetaction="hide" aria-label="Close picker">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>
            </button>
          </header>
          <div class="viz-picker__searchbar">
            <svg class="viz-picker__search-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input type="search" id="vizSearch" class="viz-picker__search" placeholder="Search modes…" autocomplete="off" spellcheck="false" />
          </div>
          <div class="viz-picker__grid" id="vizGrid" role="listbox" aria-label="Visualizer modes"></div>
          <footer class="viz-picker__footer">
            <span><kbd>V</kbd> next · <kbd>⇧</kbd>+<kbd>V</kbd> prev — cycles the full list in order</span>
            <span><kbd>Esc</kbd> close</span>
          </footer>
        </div>

        <div class="beat" id="beatDot" aria-hidden="true"></div>
      </section>
    </main>

    <footer class="transport" aria-label="Playback transport">
      <div id="transportBgFill" aria-hidden="true"></div>
      <div class="transport__np" id="transportNp">
        <img class="transport__np-cover" id="transportNpCover" src="/art/cover-panda-desiiignare.png" alt="Now playing — click for details" width="68" height="68" style="cursor:pointer" title="Open now-playing panel" />
        <div class="transport__np-meta">
          <span class="transport__np-album" id="transportNpAlbum">bZ</span>
          <span class="transport__np-title" id="transportNpTitle">Press play</span>
          <span class="transport__np-sub" id="transportNpSub">bZ</span>
        </div>
      </div>
      <div class="transport__controls">
        <button id="btnShuffle" class="round transport__shuffle" type="button" aria-label="Shuffle" title="Shuffle (S)">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>
        </button>
        <button id="btnPrev" class="round" type="button" aria-label="Previous track">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
        </button>
        <button id="btnPlay" class="round round--lg transport__play-ring" type="button" aria-label="Play / Pause">
          <span class="transport__play-progress" id="transportPlayRing" aria-hidden="true"></span>
          <svg id="playIcon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>
        </button>
        <button id="btnNext" class="round" type="button" aria-label="Next track">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
        </button>
        <button id="btnLoop" class="round transport__loop" type="button" aria-label="Loop mode" title="Loop (R)">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          <span class="transport__loop-badge" id="loopBadge" aria-hidden="true">1</span>
        </button>
      </div>
      <div class="transport__progress">
        <span class="transport__time transport__time--now" id="transportNow">0:00</span>
        <div class="transport__bar" id="bar" aria-label="Seek" role="slider" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0" tabindex="0">
          <canvas class="transport__wave" id="transportWave" aria-hidden="true"></canvas>
          <div id="transportBuffer"></div>
          <div id="transportFill"></div>
          <div id="transportThumb"></div>
          <div class="transport__hover-time" id="transportHoverTime" aria-hidden="true">0:00</div>
        </div>
        <span class="transport__time transport__time--total" id="transportTotal">0:00</span>
      </div>
      <div class="transport__vol-wrap">
        <button id="btnVol" class="round round--sm" type="button" aria-label="Mute toggle">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="volIcon">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
        </button>
        <input id="vol" class="transport__vol" type="range" min="0" max="1" step="0.01" value="0.85" aria-label="Volume">
      </div>
      <div class="transport__actions">
        <span class="transport__cast-wrap" style="position:relative;display:inline-flex;">
          <button id="btnCast" class="link-btn link-btn--icon transport__cast" type="button" aria-label="Cast to device" title="Cast to TV / speaker (Chromecast)">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 16v-2a8 8 0 0 1 8 8H8"/><path d="M2 12V9a11 11 0 0 1 11 11h-3"/><path d="M2 8V5a14 14 0 0 1 14 14h-3"/><line x1="2" y1="20" x2="2" y2="20"/><rect x="2" y="3" width="20" height="14" rx="2"/></svg>
            <span id="btnCastLabel" hidden></span>
          </button>
          <google-cast-launcher id="castLauncher" aria-hidden="true" tabindex="-1" style="position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none;cursor:pointer;"></google-cast-launcher>
        </span>
        <button id="btnAirplay" class="link-btn link-btn--icon transport__airplay" type="button" aria-label="AirPlay" title="AirPlay (Safari/macOS)" hidden>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h-1a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1"/><polygon points="12 15 17 21 7 21 12 15"/></svg>
          <span>airplay</span>
        </button>
        <button id="btnShare" class="link-btn link-btn--icon" type="button" aria-label="Share now playing">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          <span id="btnShareLabel" hidden></span>
        </button>
        <button id="btnMore" class="link-btn link-btn--icon" type="button" aria-label="More options" aria-haspopup="menu" aria-expanded="false" aria-controls="moreMenu" title="More">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="19" r="1.4"/></svg>
        </button>
      </div>
    </footer>

    <dialog class="notify" id="notifyDialog" aria-labelledby="notifyTitle">
      <form class="notify__card" id="notifyForm" method="dialog" novalidate>
        <button class="notify__close" type="button" id="notifyCloseBtn" aria-label="Close">✕</button>
        <header class="notify__head">
          <p class="notify__eyebrow">bZ · drops</p>
          <h3 class="notify__title" id="notifyTitle">First listen, every drop.</h3>
          <p class="notify__sub">No ads. No spam. One email when a song lands.</p>
        </header>
        <label class="notify__label" for="notifyEmail">Email</label>
        <input class="notify__input" id="notifyEmail" name="email" type="email" autocomplete="email" required placeholder="you@domain.com" inputmode="email" spellcheck="false" autocapitalize="off" />
        <p class="notify__error" id="notifyError" role="alert" hidden></p>
        <label class="notify__check" id="notifyPushRow" hidden>
          <input class="notify__checkbox" id="notifyPushOpt" type="checkbox" />
          <span>Also push to my lock screen <em class="notify__hint" id="notifyPushHint"></em></span>
        </label>
        <button class="notify__submit" id="notifySubmit" type="submit">Subscribe</button>
        <p class="notify__legal">Unsubscribe anytime. Stored on listmonk.megabyte.space.</p>
      </form>
    </dialog>

    <dialog class="appeal" id="appeal" aria-labelledby="appealTitle">
      <button class="appeal__close" id="appealClose" type="button" aria-label="Close appeal — return to album">✕</button>
      <h3 class="appeal__chrome" id="appealTitle">appeal — bZ → Ashton + Mila</h3>
      <iframe class="appeal__frame" id="appealFrame" title="Open letter from bZ to Ashton + Mila" loading="lazy"></iframe>
    </dialog>

    <dialog class="share" id="share" aria-labelledby="shareTitle">
      <div class="share__card">
        <header class="share__head">
          <img class="share__cover" id="shareCover" src="" alt="" width="64" height="64" />
          <div>
            <p class="share__eyebrow" id="shareEyebrow">share</p>
            <h3 class="share__title" id="shareTitle">—</h3>
            <p class="share__sub" id="shareSub">—</p>
          </div>
          <button class="share__close" id="shareClose" type="button" aria-label="Close share">✕</button>
        </header>

        <section class="share__section">
          <label class="share__label" for="shareLink">Direct link</label>
          <div class="share__row">
            <input class="share__input" id="shareLink" type="url" readonly />
            <button class="share__act" id="shareCopyLink" type="button">Copy</button>
          </div>
          <div class="share__btn-row">
            <button class="share__chip" id="shareNative" type="button" hidden>
              <span aria-hidden="true">↗</span> Share via…
            </button>
            <a class="share__chip" id="shareTweet" target="_blank" rel="noopener">
              <span aria-hidden="true">𝕏</span> Post
            </a>
            <a class="share__chip" id="shareEmail" target="_blank" rel="noopener">
              <span aria-hidden="true">✉</span> Email
            </a>
          </div>
        </section>

        <section class="share__section">
          <label class="share__label">Embed widget</label>
          <div class="share__sizes" role="radiogroup" aria-label="Embed size">
            <button class="share__size is-active" data-size="small" type="button" role="radio" aria-checked="true">Small · 320×180</button>
            <button class="share__size" data-size="medium" type="button" role="radio" aria-checked="false">Medium · 480×220</button>
            <button class="share__size" data-size="wide" type="button" role="radio" aria-checked="false">Wide · 100%×220</button>
          </div>
          <textarea class="share__embed-code" id="shareEmbedCode" readonly rows="3" aria-label="Embed iframe HTML"></textarea>
          <div class="share__row">
            <a class="share__chip" id="shareEmbedPreview" target="_blank" rel="noopener">Preview</a>
            <button class="share__act" id="shareCopyEmbed" type="button">Copy embed</button>
          </div>
        </section>
      </div>
    </dialog>

    <!-- Cmd+K search overlay -->
    <div class="cmdk" id="cmdk" role="dialog" aria-label="Search tracks" aria-modal="true">
      <div class="cmdk__dialog">
        <div class="cmdk__head">
          <svg class="cmdk__icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="cmdk__input" id="cmdkInput" type="search" placeholder="Search tracks…" autocomplete="off" spellcheck="false" aria-label="Search tracks" aria-controls="cmdkResults" aria-autocomplete="list" />
          <kbd class="cmdk__kbd">Esc</kbd>
        </div>
        <div class="cmdk__results" id="cmdkResults" role="listbox" aria-label="Search results"></div>
        <p class="cmdk__empty" id="cmdkEmpty" hidden>No tracks found</p>
        <footer class="cmdk__footer">
          <kbd class="cmdk__kbd">↑↓</kbd> navigate &nbsp;
          <kbd class="cmdk__kbd">↵</kbd> play
          <span class="cmdk__count" id="cmdkCount">0 tracks</span>
        </footer>
      </div>
    </div>

    <!-- Now-playing detail panel -->
    <div class="np-panel" id="npPanel" role="dialog" aria-label="Now playing details" aria-modal="true">
      <div class="np-panel__backdrop" id="npPanelBackdrop"></div>
      <div class="np-panel__card" id="npPanelCard">
        <button class="np-panel__close" id="npPanelClose" type="button" aria-label="Close panel">✕</button>
        <div class="np-panel__hero">
          <img class="np-panel__cover" id="npPanelCover" src="/art/cover-panda-desiiignare.png" alt="" width="90" height="90" />
          <div>
            <p class="np-panel__label" id="npPanelLabel">bZ</p>
            <h3 class="np-panel__title" id="npPanelTitle">Press play</h3>
            <p class="np-panel__bpm" id="npPanelBpm">— BPM</p>
          </div>
        </div>
        <blockquote class="np-panel__wisdom" id="npPanelWisdom">Play a track to see its wisdom.</blockquote>
        <p class="np-panel__section-label">EQ</p>
        <div class="np-panel__eq">
          <div class="np-panel__eq-knob">
            <label class="np-panel__eq-label" for="eqBass">Bass</label>
            <input class="np-panel__eq-range" id="eqBass" type="range" min="-12" max="12" step="0.5" value="3" aria-label="Bass EQ" />
            <span class="np-panel__eq-val" id="eqBassVal">+3 dB</span>
          </div>
          <div class="np-panel__eq-knob">
            <label class="np-panel__eq-label" for="eqMid">Mid</label>
            <input class="np-panel__eq-range" id="eqMid" type="range" min="-12" max="12" step="0.5" value="1" aria-label="Mid EQ" />
            <span class="np-panel__eq-val" id="eqMidVal">+1 dB</span>
          </div>
          <div class="np-panel__eq-knob">
            <label class="np-panel__eq-label" for="eqTreb">Treble</label>
            <input class="np-panel__eq-range" id="eqTreb" type="range" min="-12" max="12" step="0.5" value="2" aria-label="Treble EQ" />
            <span class="np-panel__eq-val" id="eqTrebVal">+2 dB</span>
          </div>
        </div>
        <p class="np-panel__section-label">Reverb</p>
        <div class="np-panel__reverb">
          <button class="np-panel__reverb-btn" data-preset="dry" type="button">Dry</button>
          <button class="np-panel__reverb-btn is-active" data-preset="room" type="button">Room</button>
          <button class="np-panel__reverb-btn" data-preset="hall" type="button">Hall</button>
          <button class="np-panel__reverb-btn" data-preset="cathedral" type="button">Cathedral</button>
          <button class="np-panel__reverb-btn" data-preset="spring" type="button">Spring</button>
          <button class="np-panel__reverb-btn" data-preset="plate" type="button">Plate</button>
        </div>
      </div>
    </div>

    <!-- Wisdom toast -->
    <div class="wisdom-toast" id="wisdomToast" role="status" aria-live="polite" aria-atomic="true"></div>

    <!-- More menu -->
    <div class="more-menu" id="moreMenu" role="menu" aria-label="Player options" hidden>
      <button class="more-menu__item" data-action="share" type="button" role="menuitem">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        <span>Share this track</span>
        <kbd>H</kbd>
      </button>
      <button class="more-menu__item" data-action="fs-lyrics" type="button" role="menuitem">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
        <span>Full-screen lyrics</span>
        <kbd>F</kbd>
      </button>
      <button class="more-menu__item" data-action="queue" type="button" role="menuitem">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        <span>Queue &amp; recents</span>
        <kbd>Q</kbd>
      </button>
      <button id="btnPip" class="more-menu__item" data-action="mini" type="button" role="menuitem" aria-label="Pop out mini player" title="Pop out mini player — survives tab switches" hidden>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" opacity="0.4"/></svg>
        <span>Mini player · pops out</span>
      </button>
      <div class="more-menu__divider" role="separator"></div>
      <p class="more-menu__group" role="presentation">Sleep timer · <span id="sleepLabel">off</span></p>
      <div class="more-menu__row" role="group" aria-label="Sleep timer">
        <button class="more-menu__chip" data-sleep="0" type="button" role="menuitem">Off</button>
        <button class="more-menu__chip" data-sleep="5" type="button" role="menuitem">5</button>
        <button class="more-menu__chip" data-sleep="15" type="button" role="menuitem">15</button>
        <button class="more-menu__chip" data-sleep="30" type="button" role="menuitem">30</button>
        <button class="more-menu__chip" data-sleep="60" type="button" role="menuitem">60</button>
        <button class="more-menu__chip" data-sleep="track" type="button" role="menuitem">EOT</button>
      </div>
      <div class="more-menu__divider" role="separator"></div>
      <button class="more-menu__item" data-action="shortcuts" type="button" role="menuitem">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Keyboard shortcuts</span>
        <kbd>?</kbd>
      </button>
      <button class="more-menu__item" data-action="smart-link" type="button" role="menuitem">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        <span>Smart link · all platforms</span>
      </button>
      <button class="more-menu__item more-menu__item--push" id="notifyToggle" data-action="notify" type="button" role="menuitem" aria-pressed="false">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        <span id="notifyLabel">Notify me on new drops</span>
        <span class="more-menu__dot" id="notifyDot" aria-hidden="true"></span>
      </button>
      ${SPOTIFY_ARTIST_ID ? `<a class="more-menu__item more-menu__item--link" data-action="spotify" href="https://open.spotify.com/artist/${SPOTIFY_ARTIST_ID}" target="_blank" rel="noopener" role="menuitem">
        <svg role="img" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
        <span>Open on Spotify</span>
      </a>` : ''}
    </div>

    <!-- Loop badge menu (visual hint only) -->

    <!-- Center-screen lyrics overlay (toggled via topbar L button) -->
    <aside class="karaoke" id="karaoke" aria-live="polite" aria-label="Live lyrics" hidden tabindex="-1">
      <div class="karaoke__handle" id="karaokeHandle" aria-hidden="true" title="Drag to move"><span></span></div>
      <button class="karaoke__close" id="karaokeClose" type="button" aria-label="Hide live lyrics">✕</button>
      <p class="karaoke__prev karaoke__prev--2" id="karaokePrev2"></p>
      <p class="karaoke__prev" id="karaokePrev"></p>
      <p class="karaoke__now" id="karaokeNow">Press play to see the lyrics.</p>
      <p class="karaoke__next" id="karaokeNext"></p>
      <p class="karaoke__next karaoke__next--2" id="karaokeNext2"></p>
    </aside>

    <!-- Full-screen karaoke -->
    <div class="lyrics-fs" id="lyricsFs" role="dialog" aria-label="Full-screen lyrics" aria-modal="true">
      <button class="lyrics-fs__close" id="lyricsFsClose" type="button" aria-label="Close">✕</button>
      <div class="lyrics-fs__head">
        <img class="lyrics-fs__cover" id="lyricsFsCover" src="/art/cover-panda-desiiignare.png" alt="" width="48" height="48" />
        <div>
          <p class="lyrics-fs__eyebrow" id="lyricsFsAlbum">bZ</p>
          <h3 class="lyrics-fs__title" id="lyricsFsTitle">—</h3>
        </div>
      </div>
      <div class="lyrics-fs__inner" id="lyricsFsInner"></div>
    </div>

    <!-- Queue / recents / top / AI / moods / albums panel -->
    <div class="queue-panel" id="queuePanel" role="dialog" aria-label="Library — queue, recents, top, AI, moods, albums" aria-modal="false">
      <div class="queue-panel__card">
        <header class="queue-panel__head">
          <div class="queue-panel__title">
            <span class="queue-panel__title-eye" aria-hidden="true">▶</span>
            <h3>Library</h3>
            <span class="queue-panel__title-hint" id="queueIdleHint" aria-live="polite">idle close in 60s</span>
          </div>
          <button class="queue-panel__close" id="queueClose" type="button" aria-label="Close library">✕</button>
        </header>
        <div class="queue-panel__tabs" role="tablist" id="queueTabs">
          <button class="queue-panel__tab is-active" data-tab="up-next" type="button" role="tab" aria-selected="true">
            <span class="queue-panel__tab-ico" aria-hidden="true">→</span><span>Queue</span>
          </button>
          <button class="queue-panel__tab" data-tab="ai" type="button" role="tab" aria-selected="false">
            <span class="queue-panel__tab-ico" aria-hidden="true">✦</span><span>AI</span>
          </button>
          <button class="queue-panel__tab" data-tab="recent" type="button" role="tab" aria-selected="false">
            <span class="queue-panel__tab-ico" aria-hidden="true">↺</span><span>Recents</span>
          </button>
          <button class="queue-panel__tab" data-tab="top" type="button" role="tab" aria-selected="false">
            <span class="queue-panel__tab-ico" aria-hidden="true">★</span><span>Top</span>
          </button>
          <button class="queue-panel__tab" data-tab="moods" type="button" role="tab" aria-selected="false">
            <span class="queue-panel__tab-ico" aria-hidden="true">◐</span><span>Moods</span>
          </button>
          <button class="queue-panel__tab" data-tab="albums" type="button" role="tab" aria-selected="false">
            <span class="queue-panel__tab-ico" aria-hidden="true">◉</span><span>Albums</span>
          </button>
        </div>
        <div class="queue-panel__body" id="queueBody"></div>
      </div>
    </div>

    <!-- Keyboard shortcuts overlay -->
    <dialog class="shortcuts" id="shortcuts" aria-labelledby="shortcutsTitle">
      <button class="shortcuts__close" id="shortcutsCloseBtn" type="button" aria-label="Close">✕</button>
      <h3 class="shortcuts__title" id="shortcutsTitle">Keyboard shortcuts</h3>
      <div class="shortcuts__grid">
        <div><kbd>Space</kbd><span>Play / pause</span></div>
        <div><kbd>←</kbd> <kbd>→</kbd><span>Previous / next</span></div>
        <div><kbd>[</kbd> <kbd>]</kbd><span>Seek −10s / +10s</span></div>
        <div><kbd>0</kbd>—<kbd>9</kbd><span>Seek to 0% — 90%</span></div>
        <div><kbd>↑</kbd> <kbd>↓</kbd><span>Volume up / down</span></div>
        <div><kbd>M</kbd><span>Mute toggle</span></div>
        <div><kbd>S</kbd><span>Shuffle</span></div>
        <div><kbd>R</kbd><span>Loop mode</span></div>
        <div><kbd>L</kbd> <kbd>F</kbd><span>Full-screen lyrics</span></div>
        <div><kbd>V</kbd><span>Visualizer mode</span></div>
        <div><kbd>H</kbd><span>Share track</span></div>
        <div><kbd>Q</kbd><span>Queue panel</span></div>
        <div><kbd>N</kbd><span>Now-playing panel</span></div>
        <div><kbd>⌘K</kbd><span>Search</span></div>
        <div><kbd>?</kbd><span>This menu</span></div>
        <div><kbd>Esc</kbd><span>Close panels</span></div>
      </div>
    </dialog>

    <!-- Install PWA banner -->
    <div class="install-banner" id="installBanner" role="status" hidden>
      <span class="install-banner__txt" id="installBannerTxt">Install bZ as an app — instant launch + offline.</span>
      <button id="installAccept" class="install-banner__btn install-banner__btn--primary" type="button">Install</button>
      <button id="installDismiss" class="install-banner__btn" type="button" aria-label="Dismiss">Later</button>
    </div>

    <!-- Cast sheet — Android-TV-clone remote with palette-aware UI, synced lyrics, multi-mode visualizer, Hue light sync -->
    <dialog class="cast-sheet" id="castSheet" aria-labelledby="castTitle" aria-describedby="castSubtitle">
      <div class="cast-sheet__bg" aria-hidden="true"></div>
      <div class="cast-sheet__halo" aria-hidden="true"></div>
      <div class="cast-sheet__inner">
        <header class="cast-sheet__top">
          <span class="cast-sheet__pill">
            <span class="cast-sheet__pill-dot" aria-hidden="true"></span>
            <span class="cast-sheet__pill-text" id="castPillText">Casting</span>
            <span class="cast-sheet__pill-sep" aria-hidden="true">·</span>
            <span class="cast-sheet__pill-device" id="castDeviceName">device</span>
          </span>
          <div class="cast-sheet__top-actions">
            <button id="castHueIndicator" class="cast-sheet__chip" type="button" aria-pressed="false" aria-label="Hue lights status">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>
              <span id="castHueIndicatorLabel">Hue</span>
            </button>
            <button id="castVizMode" class="cast-sheet__chip" type="button" aria-label="Cycle visualizer mode">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="14"/></svg>
              <span id="castVizModeLabel">Bars</span>
            </button>
            <button id="castSettingsBtn" class="cast-sheet__chip" type="button" aria-label="Open settings" aria-haspopup="dialog">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8h0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
              <span>Settings</span>
            </button>
            <button id="castFsBtn" class="cast-sheet__chip" type="button" aria-label="Toggle fullscreen">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            </button>
            <button class="cast-sheet__close" id="castSheetClose" type="button" aria-label="Close cast panel">✕</button>
          </div>
        </header>

        <div class="cast-tv">
          <figure class="cast-tv__art">
            <img class="cast-tv__cover" id="castCover" src="/art/cover-panda-desiiignare.png" alt="" width="640" height="640" decoding="async" />
            <div class="cast-tv__art-glow" aria-hidden="true"></div>
            <div class="cast-tv__art-pulse" id="castArtPulse" aria-hidden="true"></div>
          </figure>

          <section class="cast-tv__center">
            <hgroup class="cast-tv__meta">
              <p class="cast-tv__eyebrow" id="castAlbum">bZ</p>
              <h3 class="cast-tv__title" id="castTitle">—</h3>
              <p class="cast-tv__sub" id="castSubtitle">—</p>
              <p class="cast-tv__bpm"><span id="castBpm">—</span> BPM · <span id="castKey">live</span></p>
            </hgroup>

            <div class="cast-tv__lyrics" id="castLyrics" aria-live="polite" aria-label="Synced lyrics">
              <p class="cast-tv__lyrics-empty" id="castLyricsEmpty">Lyrics syncing…</p>
            </div>
          </section>

          <aside class="cast-tv__rail" aria-label="Up next">
            <h4 class="cast-tv__rail-title">Up next</h4>
            <ol class="cast-tv__queue" id="castQueue"></ol>
          </aside>
        </div>

        <canvas class="cast-tv__viz" id="castViz" width="1280" height="180" aria-hidden="true"></canvas>

        <div class="cast-sheet__progress">
          <span class="cast-sheet__time" id="castNow">0:00</span>
          <div class="cast-sheet__bar" id="castBar" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0" tabindex="0">
            <div class="cast-sheet__bar-fill" id="castFill"></div>
            <div class="cast-sheet__bar-thumb" id="castThumb"></div>
          </div>
          <span class="cast-sheet__time" id="castTotal">0:00</span>
        </div>

        <div class="cast-sheet__controls">
          <button id="castPrev" class="cast-sheet__btn" type="button" aria-label="Previous track">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
          </button>
          <button id="castSeekBack" class="cast-sheet__btn" type="button" aria-label="Back 10 seconds">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            <span class="cast-sheet__btn-num">10</span>
          </button>
          <button id="castPlay" class="cast-sheet__btn cast-sheet__btn--play" type="button" aria-label="Play / pause">
            <svg id="castPlayIcon" viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>
          </button>
          <button id="castSeekFwd" class="cast-sheet__btn" type="button" aria-label="Forward 10 seconds">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span class="cast-sheet__btn-num">10</span>
          </button>
          <button id="castNext" class="cast-sheet__btn" type="button" aria-label="Next track">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
          </button>
        </div>

        <div class="cast-sheet__vol">
          <button id="castMute" class="cast-sheet__btn cast-sheet__btn--sm" type="button" aria-label="Mute on receiver">
            <svg id="castVolIcon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
          </button>
          <input id="castVol" class="cast-sheet__vol-range" type="range" min="0" max="1" step="0.01" value="1" aria-label="Receiver volume" />
          <span class="cast-sheet__vol-pct" id="castVolPct">100%</span>
        </div>

        <footer class="cast-sheet__foot">
          <p class="cast-sheet__note">
            <span class="cast-sheet__note-tag">Web Audio</span>
            Mirror analyser feeds the live visualizer locally — receiver streams the source MP3 direct.
          </p>
          <button id="castStop" class="cast-sheet__stop" type="button">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
            Stop casting
          </button>
        </footer>

        <!-- Settings drawer (Hue + Viz + Display) -->
        <aside class="cast-settings" id="castSettings" aria-hidden="true" role="dialog" aria-label="Cast settings">
          <header class="cast-settings__top">
            <h4>Settings</h4>
            <button id="castSettingsClose" class="cast-settings__x" type="button" aria-label="Close settings">✕</button>
          </header>

          <section class="cast-settings__group">
            <h5>Philips Hue</h5>
            <p class="cast-settings__hint" id="castHueHint">Sync your bulbs to the music — accent color, bass-driven brightness, beat flashes. Tap discover, then press the round button on your bridge.</p>
            <div class="cast-settings__row">
              <button id="castHueDiscover" class="cast-settings__btn" type="button">Discover bridges</button>
              <input id="castHueIp" class="cast-settings__input" type="text" placeholder="192.168.1.42" inputmode="decimal" aria-label="Bridge IP" />
              <button id="castHueLink" class="cast-settings__btn cast-settings__btn--primary" type="button">Link</button>
            </div>
            <p class="cast-settings__error" id="castHueError" role="alert" hidden></p>
            <div class="cast-settings__row" id="castHueGroupRow" hidden>
              <label class="cast-settings__label">Group</label>
              <select id="castHueGroup" class="cast-settings__select"></select>
            </div>
            <div class="cast-settings__row" id="castHueIntensityRow" hidden>
              <label class="cast-settings__label" for="castHueIntensity">Intensity</label>
              <input id="castHueIntensity" type="range" min="0" max="1" step="0.01" value="0.7" class="cast-settings__range" />
              <span class="cast-settings__pct" id="castHueIntensityPct">70%</span>
            </div>
            <div class="cast-settings__row" id="castHueGradientRow" hidden>
              <label class="cast-settings__toggle">
                <input id="castHueGradient" type="checkbox" />
                <span>Light Bar gradient (5-zone, ~22Hz)</span>
              </label>
              <span class="cast-settings__pct" id="castHueGradientStatus" aria-live="polite">No gradient lights</span>
            </div>
            <div class="cast-settings__row" id="castHueEnableRow" hidden>
              <label class="cast-settings__toggle">
                <input id="castHueEnable" type="checkbox" />
                <span>Sync lights to music</span>
              </label>
              <button id="castHueUnlink" class="cast-settings__btn cast-settings__btn--ghost" type="button">Unlink bridge</button>
            </div>
          </section>

          <section class="cast-settings__group">
            <h5>Visualizer</h5>
            <div class="cast-settings__row cast-settings__row--seg">
              <button class="cast-seg" data-viz="bars" aria-pressed="true">Bars</button>
              <button class="cast-seg" data-viz="circle" aria-pressed="false">Radial</button>
              <button class="cast-seg" data-viz="particles" aria-pressed="false">Particles</button>
            </div>
          </section>

          <section class="cast-settings__group">
            <h5>Receiver</h5>
            <div class="cast-settings__row">
              <label class="cast-settings__toggle">
                <input id="castReceiverMode" type="checkbox" />
                <span>Branded TV UI <span class="cast-settings__hint-inline">(custom 228565CB)</span></span>
              </label>
            </div>
            <p class="cast-settings__hint">Off: stock Google Media Receiver — works on any Cast device. On: custom 10-foot UI with synced lyrics, palette, queue. Requires a device registered to <code>228565CB</code>; falls back automatically if not.</p>
          </section>

          <section class="cast-settings__group">
            <h5>About</h5>
            <p class="cast-settings__about">Android-TV-style remote for bZ. Live frequency analysis on the local Web Audio mirror, receiver streams source MP3, palette extracted per-track from album art, lyrics from LRC files when available.</p>
          </section>
        </aside>
      </div>
    </dialog>

    <dialog class="autoplay" id="autoplayPrompt" aria-labelledby="apTitle">
      <div class="autoplay__card">
        <img class="autoplay__cover" id="apCover" src="" alt="" width="120" height="120" />
        <div class="autoplay__body">
          <p class="autoplay__eyebrow">tap to play</p>
          <h3 class="autoplay__title" id="apTitle">—</h3>
          <p class="autoplay__meta" id="apMeta">—</p>
          <div class="autoplay__row">
            <button id="apPlay" class="autoplay__play" type="button" aria-label="Play track">
              <svg class="autoplay__play-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>
              <span>Play</span>
            </button>
            <button id="apClose" class="autoplay__skip" type="button" aria-label="Dismiss">Not now</button>
          </div>
        </div>
      </div>
    </dialog>
  `;
}

function mandalaSVG(): string {
  const ticks = Array.from({ length: 24 }, (_, i) =>
    `<g transform="rotate(${i * 15})"><line x1="0" y1="-142" x2="0" y2="-120"/></g>`
  ).join('');
  const petals = Array.from({ length: 12 }, (_, i) =>
    `<g transform="rotate(${i * 30})"><path d="M 0 -120 Q 12 -94 0 -68 Q -12 -94 0 -120 Z"/></g>`
  ).join('');
  const smallPetals = Array.from({ length: 8 }, (_, i) =>
    `<g transform="rotate(${i * 45 + 22.5})"><path d="M 0 -68 Q 7 -55 0 -42 Q -7 -55 0 -68 Z"/></g>`
  ).join('');
  const starPath = '0,-3 0.88,-0.93 2.85,-0.93 1.28,0.36 1.87,2.33 0,1.13 -1.87,2.33 -1.28,0.36 -2.85,-0.93 -0.88,-0.93';
  const stars = Array.from({ length: 12 }, (_, i) =>
    `<g transform="rotate(${i * 30}) translate(0 -150) rotate(180)"><polygon points="${starPath}"/></g>`
  ).join('');
  return `
    <svg class="album__cover-mandala" viewBox="0 0 320 320" aria-hidden="true" focusable="false">
      <g fill="none" stroke="rgba(232,232,240,0.42)" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="160" cy="160" r="150" stroke-width="0.5"/>
        <circle cx="160" cy="160" r="142" stroke-width="0.4" stroke-dasharray="2 4" stroke-opacity="0.6"/>
        <circle cx="160" cy="160" r="120" stroke-width="0.5"/>
        <circle cx="160" cy="160" r="94"  stroke-width="0.45"/>
        <circle cx="160" cy="160" r="68"  stroke-width="0.55"/>
        <circle cx="160" cy="160" r="42"  stroke-width="0.5"/>
        <circle cx="160" cy="160" r="22"  stroke-width="0.6"/>
        <g transform="translate(160 160)" stroke-width="0.45" stroke-opacity="0.55">${ticks}</g>
        <g transform="translate(160 160)" stroke-width="0.55" stroke-opacity="0.62">${petals}</g>
        <g transform="translate(160 160)" stroke-width="0.5" stroke-opacity="0.5">${smallPetals}</g>
        <g transform="translate(160 160)" fill="rgba(232,232,240,0.38)" stroke="none">${stars}</g>
        <g transform="translate(160 160) rotate(180)" stroke-width="0.7" stroke-opacity="0.78">
          <polygon points="0,-18 5.29,-5.56 17.12,-5.56 7.72,2.12 11.21,13.98 0,6.75 -11.21,13.98 -7.72,2.12 -17.12,-5.56 -5.29,-5.56"/>
        </g>
        <g stroke-width="0.55" stroke-opacity="0.88">
          <path d="M 158 154 Q 150 158 152 166 Q 156 171 160 167"/>
          <path d="M 162 166 Q 170 162 168 154 Q 164 149 160 153"/>
          <circle cx="156.5" cy="159.5" r="0.7" fill="rgba(232,232,240,0.85)" stroke="none"/>
          <circle cx="163.5" cy="160.5" r="0.7" fill="rgba(232,232,240,0.85)" stroke="none"/>
        </g>
      </g>
    </svg>
  `;
}

function renderAlbums(host: HTMLElement) {
  const savedTop = host.scrollTop;
  const isFeatured = Boolean(currentAlbumFilter);
  const visible = currentAlbumFilter
    ? ALBUMS.filter(a => a.id === currentAlbumFilter)
    : [...ALBUMS].sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? ''));
  const back = currentAlbumFilter
    ? `<a class="albums__back" data-albums-back href="/" aria-label="Back to all albums"><svg class="albums__back-arrow" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg><span>all albums</span></a>`
    : '';
  const aiPlaylistModule = currentAlbumFilter ? '' : `
    <aside class="ai-playlist ai-playlist--rail" aria-label="AI's Choice — top picks for you" id="aiPlaylistWrap">
      <header class="ai-playlist__head">
        <span class="ai-playlist__eyebrow">AI's Choice</span>
      </header>
      <div class="ai-playlist__list" id="aiPlaylist" role="list"></div>
    </aside>`;
  const spotifyEmbed = SPOTIFY_ARTIST_ID
    ? `<div class="album__spotify"><iframe src="https://open.spotify.com/follow/1/?uri=spotify:artist:${SPOTIFY_ARTIST_ID}&size=detail&theme=dark&show-count=0" width="100%" height="56" scrolling="no" frameborder="0" allowtransparency="true" allow="encrypted-media" title="Follow bZ on Spotify"></iframe></div>`
    : '';
  host.innerHTML = back + aiPlaylistModule + visible.map(album => {
    const tracks = album.trackIds.map(id => TRACK_BY_ID.get(id)).filter(Boolean) as Track[];
    return `
      <section class="album ${isFeatured ? 'album--featured' : ''}" data-album="${album.id}" style="--album-accent: ${album.accent};">
        <header class="album__head">
          <div class="album__cover-stage">
            <a class="album__cover" data-album-link="${album.id}" href="${albumPath(album.id)}" aria-label="Open ${album.name}">
              <img src="${album.cover}" alt="${album.name} cover art" loading="lazy" decoding="async" />
            </a>
            ${isFeatured ? `
              <div class="album__cover-veil" aria-hidden="true">${mandalaSVG()}</div>
              <button class="album__cover-share" type="button" data-share-album="${album.id}" aria-label="Share ${album.name}">
                <span class="album__cover-share-eyebrow">No pity from the stars</span>
                <span class="album__cover-share-line">Don't Share.</span>
                <span class="album__cover-share-sub">They Already Cancelled You.</span>
              </button>
            ` : ''}
          </div>
          <div class="album__head-meta">
            <p class="album__eyebrow">album${album.releasedAt ? ` · ${album.releasedAt}` : ''}</p>
            <h3 class="album__title">${album.name}</h3>
            <p class="album__tagline">${album.tagline}</p>
            <p class="album__count">${tracks.length} tracks · bZ</p>
          </div>
        </header>
        ${isFeatured ? spotifyEmbed : ''}
        <ol class="album__tracks" role="list">
          ${tracks.map((t, idx) => {
            const plays = playCounts.get(t.id) ?? 0;
            return `
            <li class="trackrow-wrap">
              <a class="trackrow ${t.id === currentTrackId ? 'is-current' : ''}" data-track="${t.id}" data-tags="${trackTagsAttr(t.id)}" href="${trackPath(t)}">
                <span class="trackrow__num"><span class="trackrow__bars" aria-hidden="true"><i></i><i></i><i></i></span><span class="trackrow__num-txt">${(idx + 1).toString().padStart(2, '0')}</span></span>
                <span class="trackrow__title">${t.title}</span>
                <span class="trackrow__vibe">${t.vibe}</span>
                <span class="trackrow__stats" aria-label="${plays} plays">
                  <span class="trackrow__plays" data-plays="${t.id}"${plays === 0 ? ' hidden' : ''}>
                    <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                    <span data-plays-num="${t.id}">${plays}</span>
                  </span>
                </span>
              </a>
              <button class="share-chip share-chip--row" type="button" data-share-track="${t.id}" aria-label="Share ${t.title}">
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              </button>
            </li>
          `;
          }).join('')}
        </ol>
        <button class="album__subscribe" type="button" data-action="notify" aria-label="Get notified when bZ drops a new track">
          <span class="album__subscribe-eyebrow">bZ · drops</span>
          <span class="album__subscribe-line">First listen, every drop. <em>Subscribe →</em></span>
        </button>
      </section>
    `;
  }).join('');
  host.scrollTop = savedTop;
  if (!currentAlbumFilter) {
    bindAiPlaylist();
    refreshAiPlaylist();
  }
}

type TagChip = { kind: 'mood' | 'theme' | 'genre' | 'place' | 'tempo' | 'energy'; label: string };

function topTagsFor(tags: ReturnType<typeof getTrackTags>, max = 5): TagChip[] {
  if (!tags) return [];
  const chips: TagChip[] = [];
  tags.moods.slice(0, 2).forEach(m => chips.push({ kind: 'mood', label: m }));
  tags.genres.slice(0, 1).forEach(g => chips.push({ kind: 'genre', label: g }));
  tags.themes.slice(0, 1).forEach(t => chips.push({ kind: 'theme', label: t }));
  tags.places.slice(0, 1).forEach(p => chips.push({ kind: 'place', label: p }));
  if (chips.length < max) chips.push({ kind: 'energy', label: tags.energy });
  if (chips.length < max) chips.push({ kind: 'tempo', label: `${tags.identifiers.bpmHint} bpm` });
  return chips.slice(0, max);
}

function trackTagsAttr(trackId: string): string {
  const t = TRACK_TAGS.get(trackId);
  if (!t) return '';
  const flat = [...t.moods, ...t.themes, ...t.genres, ...t.places, t.energy, t.tempo, ...t.contains];
  return flat.join(' ');
}

function renderNowPlaying(track: Track | null) {
  const album = track ? ALBUM_BY_ID.get(track.album) : null;
  const heroAlbum = $('#heroAlbum');
  const heroTitle = $('#heroTitle');
  const heroVibe = $('#heroVibe');
  const npChrome = $('#npChrome');
  if (heroAlbum) heroAlbum.textContent = (album?.name || 'bZ · Cyan Flag').toUpperCase();
  if (heroTitle) heroTitle.textContent = (track ? track.title : 'PRESS PLAY').toUpperCase();
  if (heroVibe) heroVibe.textContent = track?.vibe || 'Web Audio API live. Hard but holy.';
  const heroTags = $('#heroTags');
  if (heroTags) {
    const tags = track ? getTrackTags(track.id) : undefined;
    const chips = tags ? topTagsFor(tags, 5) : [];
    if (chips.length) {
      heroTags.innerHTML = chips.map(c => `<span class="viz__hero-tag viz__hero-tag--${c.kind}" title="${c.kind}">${c.label}</span>`).join('');
      heroTags.hidden = false;
    } else {
      heroTags.innerHTML = '';
      heroTags.hidden = true;
    }
  }
  if (npChrome) npChrome.textContent = track ? `${track.title} — ${album?.name ?? 'bZ'}` : 'press play';
  const npCover = $('#transportNpCover') as HTMLImageElement | null;
  const npAlbum = $('#transportNpAlbum');
  const npTitle = $('#transportNpTitle');
  const npSub = $('#transportNpSub');
  if (npCover) npCover.src = album?.cover ?? '/art/cover-panda-desiiignare.png';
  if (npAlbum) npAlbum.textContent = album?.name ?? 'bZ';
  if (npTitle) npTitle.textContent = track?.title ?? 'Press play';
  if (npSub) npSub.textContent = track ? (track.vibe ?? 'bZ') : 'bZ';
  if (track && album) {
    document.documentElement.style.setProperty('--accent', album.accent);
    visualizer?.setAccent(album.accent);
  }
}

function refreshVolIcon() {
  const volInput = $('#vol') as HTMLInputElement | null;
  const icon = $('#volIcon');
  if (!volInput || !icon) return;
  const v = Number(volInput.value);
  const muted = v <= 0;
  const partial = v > 0 && v < 0.5;
  icon.innerHTML = muted
    ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>'
    : partial
    ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>'
    : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>';
}

/**
 * Loads lyrics for a track. Priority: (1) /lyrics/{id}.json with Whisper word-level timing,
 * (2) estimated fallback that divides track duration evenly across data.ts lyrics lines.
 * Results are cached in-memory after first fetch.
 */
async function loadLyrics(track: Track): Promise<LyricsBundle> {
  if (lyricsCache.has(track.id)) {
    const c = lyricsCache.get(track.id);
    if (c) return c;
  }
  try {
    const r = await fetch(`/lyrics/${track.id}.json`, { cache: 'force-cache' });
    if (r.ok) {
      const j = await r.json() as { words?: WhisperWord[]; lines: WhisperLine[]; duration?: number; source?: LyricsSource };
      const bundle: LyricsBundle = { ...j, source: j.source ?? (j.words ? 'whisper' : 'aligned') };
      lyricsCache.set(track.id, bundle);
      return bundle;
    }
  } catch { /* fall through */ }
  const dur = engine.audio.duration && Number.isFinite(engine.audio.duration) ? engine.audio.duration : 180;
  const lines = track.lyrics && track.lyrics.length
    ? track.lyrics
    : [
        track.title,
        track.vibe || '—',
        'Lyrics unavailable for this drop.',
        'Press F for full-screen visualizer.'
      ];
  const bundle = synthesizeBundle(lines, dur);
  lyricsCache.set(track.id, bundle);
  return bundle;
}

/**
 * Synthesizes per-word timings from plain lyric lines: each line gets a span
 * proportional to its character count; each word inside the line gets a slice
 * proportional to its own character count. Result enables word-by-word
 * follow-along even without Whisper transcription.
 */
function synthesizeBundle(lyricLines: string[], duration: number): LyricsBundle {
  const head = 1.2;
  const usable = Math.max(8, duration - head - 0.5);
  const lineWeights = lyricLines.map(t => Math.max(8, t.trim().length));
  const totalWeight = lineWeights.reduce((a, b) => a + b, 0) || 1;
  const lines: WhisperLine[] = [];
  const words: WhisperWord[] = [];
  let cursor = head;
  lyricLines.forEach((text, i) => {
    const span = (lineWeights[i] / totalWeight) * usable;
    const lineStart = cursor;
    const lineEnd = cursor + span;
    lines.push({ s: lineStart, e: lineEnd, text });
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length) {
      const tokenWeights = tokens.map(w => Math.max(2, w.length));
      const tokenTotal = tokenWeights.reduce((a, b) => a + b, 0);
      let wCursor = lineStart;
      tokens.forEach((w, ti) => {
        const wSpan = (tokenWeights[ti] / tokenTotal) * span;
        words.push({ w, s: wCursor, e: wCursor + wSpan, line: i });
        wCursor += wSpan;
      });
    }
    cursor = lineEnd;
  });
  return { words, lines, duration, source: 'estimated-words' };
}

/**
 * RAF-based lyrics loop — full-screen view with line + word highlighting.
 * Lines render into #lyricsFsInner; active line is scrolled to center; the
 * active word inside that line gets gradient + glow when Whisper words exist.
 */
function buildLyricsLines(bundle: LyricsBundle) {
  const fsInner = $('#lyricsFsInner') as HTMLElement | null;
  if (!fsInner) return;
  lyricsRenderedBundle = bundle;
  lyricsCurLineWords = [];
  lyricsCurWordSpans = [];
  lyricsLastLineIdx = -2;
  lyricsLastWordIdx = -2;
  lyricsLastScrollIdx = -2;
  fsInner.innerHTML = bundle.lines.map((l, i) =>
    `<p class="lyrics-fs__line lyrics-fs__line--future" data-fs-idx="${i}">${escapeHtml(capitalizeLyricLine(l.text))}</p>`
  ).join('');
  lyricsLineEls = Array.from(fsInner.querySelectorAll<HTMLParagraphElement>('.lyrics-fs__line'));
  fitLyricsLines();
}

/** Per-line auto-fit: shrink font-size until scrollWidth ≤ clientWidth so a
 *  single authored lyric line never wraps to a second display row. */
function fitLyricsLines() {
  if (!lyricsLineEls.length) return;
  // Two RAFs: first lets layout settle; second measures + fits.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const el of lyricsLineEls) {
      el.style.removeProperty('--lyric-fit');
      el.removeAttribute('data-fitted');
      const cs = getComputedStyle(el);
      const baseFs = parseFloat(cs.fontSize);
      const minFs = 12;
      let fs = baseFs;
      let guard = 24;
      while (el.scrollWidth > el.clientWidth && fs > minFs && guard-- > 0) {
        fs = Math.max(minFs, fs * 0.94);
        el.style.setProperty('--lyric-fit', `${fs}px`);
        el.setAttribute('data-fitted', '1');
      }
    }
  }));
}

function activateLyricsLine(idx: number, bundle: LyricsBundle) {
  const el = lyricsLineEls[idx];
  if (!el) return;
  const words = bundle.words;
  const ln = bundle.lines[idx];
  if (!ln) return;
  let lineWords = words ? words.filter(w => (w.line ?? -1) === idx) : [];
  if (!lineWords.length && words) {
    lineWords = words.filter(w => w.s >= ln.s - 0.2 && w.s < ln.e + 0.2);
  }
  if (lineWords.length) {
    lyricsCurLineWords = lineWords;
    el.innerHTML = lineWords
      .map((w, i) => {
        const text = i === 0
          ? escapeHtml(w.w.charAt(0).toUpperCase() + w.w.slice(1))
          : escapeHtml(w.w);
        return `<span class="lyrics-fs__w" data-idx="${i}">${text}</span>`;
      })
      .join(' ');
    lyricsCurWordSpans = Array.from(el.querySelectorAll<HTMLSpanElement>('.lyrics-fs__w'));
  } else {
    lyricsCurLineWords = [];
    lyricsCurWordSpans = [];
    el.textContent = ln.text;
  }
  // Re-measure JUST this line in case word-span template altered its width.
  if (el.scrollWidth > el.clientWidth) fitLyricsLines();
  lyricsLastWordIdx = -2;
}

function restoreLyricsLine(idx: number, bundle: LyricsBundle) {
  const el = lyricsLineEls[idx];
  if (!el) return;
  el.textContent = bundle.lines[idx]?.text ?? '';
}

function bindLyricsClick() {
  if (lyricsClickBound) return;
  const fsInner = $('#lyricsFsInner') as HTMLElement | null;
  if (!fsInner) return;
  fsInner.addEventListener('click', e => {
    if (!activeLyrics) return;
    const target = (e.target as HTMLElement).closest('.lyrics-fs__line') as HTMLParagraphElement | null;
    if (!target) return;
    const idx = Number(target.dataset.fsIdx ?? -1);
    const line = activeLyrics.lines[idx];
    if (line) engine.audio.currentTime = line.s;
  });
  lyricsClickBound = true;
}

function startKaraoke() {
  if (lyricsRaf !== null) return;
  const fsInner = $('#lyricsFsInner') as HTMLElement | null;
  if (!fsInner) { lyricsRaf = requestAnimationFrame(() => { lyricsRaf = null; startKaraoke(); }); return; }
  bindLyricsClick();

  const tick = () => {
    if (!activeLyrics) {
      lyricsRaf = requestAnimationFrame(tick);
      return;
    }

    if (activeLyrics !== lyricsRenderedBundle) {
      buildLyricsLines(activeLyrics);
      lyricsRaf = requestAnimationFrame(tick);
      return;
    }

    const t = engine.audio.currentTime;
    const lines = activeLyrics.lines;
    let idx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (t >= lines[i].s && t < lines[i].e) { idx = i; break; }
      if (t < lines[i].s) { idx = Math.max(0, i - 1); break; }
      idx = i;
    }

    if (idx !== lyricsLastLineIdx) {
      if (lyricsLastLineIdx >= 0 && lyricsLastLineIdx !== idx) restoreLyricsLine(lyricsLastLineIdx, activeLyrics);
      for (let i = 0; i < lyricsLineEls.length; i++) {
        lyricsLineEls[i].classList.toggle('lyrics-fs__line--past', i < idx);
        lyricsLineEls[i].classList.toggle('lyrics-fs__line--active', i === idx);
        lyricsLineEls[i].classList.toggle('lyrics-fs__line--future', i > idx);
      }
      activateLyricsLine(idx, activeLyrics);
      lyricsLastLineIdx = idx;
    }

    if (karaokeOverlayOn && idx !== karaokeLastIdx) {
      paintKaraokeOverlay(idx, activeLyrics);
      karaokeLastIdx = idx;
    }

    if (lyricsFsOpen && idx !== lyricsLastScrollIdx) {
      const active = lyricsLineEls[idx];
      if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
      lyricsLastScrollIdx = idx;
    }

    if (lyricsCurWordSpans.length && lyricsCurLineWords.length) {
      let active = -1;
      for (let i = 0; i < lyricsCurLineWords.length; i++) {
        const w = lyricsCurLineWords[i];
        if (t >= w.s && t < w.e) { active = i; break; }
        if (t < w.s) { active = i - 1; break; }
      }
      if (active === -1 && t >= lyricsCurLineWords[lyricsCurLineWords.length - 1].e) active = lyricsCurLineWords.length - 1;
      if (active !== lyricsLastWordIdx) {
        for (let i = 0; i < lyricsCurWordSpans.length; i++) {
          lyricsCurWordSpans[i].classList.toggle('lyrics-fs__w--past', i < active);
          lyricsCurWordSpans[i].classList.toggle('lyrics-fs__w--active', i === active);
        }
        lyricsLastWordIdx = active;
      }
    }

    if (karaokeOverlayOn && karaokeOverlayWordSpans.length && karaokeOverlayWords.length) {
      let oa = -1;
      for (let i = 0; i < karaokeOverlayWords.length; i++) {
        const w = karaokeOverlayWords[i];
        if (t >= w.s && t < w.e) { oa = i; break; }
        if (t < w.s) { oa = i - 1; break; }
      }
      if (oa === -1 && t >= karaokeOverlayWords[karaokeOverlayWords.length - 1].e) oa = karaokeOverlayWords.length - 1;
      if (oa !== karaokeOverlayWordIdx) {
        for (let i = 0; i < karaokeOverlayWordSpans.length; i++) {
          karaokeOverlayWordSpans[i].classList.toggle('karaoke__w--past', i < oa);
          karaokeOverlayWordSpans[i].classList.toggle('karaoke__w--active', i === oa);
        }
        karaokeOverlayWordIdx = oa;
      }
    }

    // FFT amplitude coupling — active word glow + scale modulated by the
    // vocal-band energy so words physically "sing" with the track. Reads
    // the visualizer-owned analyser via the engine.
    if (fsInner) {
      const meters = visualizer?.audioMeters();
      const beat = meters?.beat ?? 0;
      const mid = meters?.mid ?? 0;
      const treble = meters?.treble ?? 0;
      const energy = Math.min(1, mid * 0.7 + treble * 0.4 + beat * 0.45);
      fsInner.style.setProperty('--karaoke-energy', energy.toFixed(3));
      fsInner.style.setProperty('--karaoke-beat', beat.toFixed(3));
    }

    lyricsRaf = requestAnimationFrame(tick);
  };
  lyricsRaf = requestAnimationFrame(tick);
}

/**
 * Paints the center-screen karaoke overlay (#karaoke). Shows previous, current,
 * and next line, each capitalized. Tinted by the album/track accent so it sits
 * naturally over the visualizer.
 */
function paintKaraokeOverlay(idx: number, bundle: LyricsBundle) {
  const host = $('#karaoke') as HTMLElement | null;
  if (!host || host.hidden) return;
  const prev2 = $('#karaokePrev2') as HTMLElement | null;
  const prev = $('#karaokePrev') as HTMLElement | null;
  const now = $('#karaokeNow') as HTMLElement | null;
  const next = $('#karaokeNext') as HTMLElement | null;
  const next2 = $('#karaokeNext2') as HTMLElement | null;
  if (!prev || !now || !next) return;
  const lines = bundle.lines;
  if (prev2) prev2.textContent = idx > 1 ? capitalizeLyricLine(lines[idx - 2].text) : '';
  prev.textContent = idx > 0 ? capitalizeLyricLine(lines[idx - 1].text) : '';
  if (next2) next2.textContent = idx + 2 < lines.length ? capitalizeLyricLine(lines[idx + 2].text) : '';
  next.textContent = idx + 1 < lines.length ? capitalizeLyricLine(lines[idx + 1].text) : '';

  // Per-word render for current line — drives karaoke__w--active highlighting.
  karaokeOverlayWords = [];
  karaokeOverlayWordSpans = [];
  karaokeOverlayWordIdx = -2;
  const ln = lines[idx];
  if (ln) {
    const words = bundle.words ?? [];
    let lineWords = words.filter(w => (w.line ?? -1) === idx);
    if (!lineWords.length && words.length) {
      lineWords = words.filter(w => w.s >= ln.s - 0.2 && w.s < ln.e + 0.2);
    }
    if (lineWords.length) {
      karaokeOverlayWords = lineWords;
      now.innerHTML = lineWords
        .map((w, i) => {
          const text = i === 0
            ? escapeHtml(w.w.charAt(0).toUpperCase() + w.w.slice(1))
            : escapeHtml(w.w);
          return `<span class="karaoke__w" data-idx="${i}">${text}</span>`;
        })
        .join(' ');
      karaokeOverlayWordSpans = Array.from(now.querySelectorAll<HTMLSpanElement>('.karaoke__w'));
    } else {
      now.textContent = capitalizeLyricLine(ln.text);
    }
  } else {
    now.textContent = '';
  }
  host.classList.add('is-pulse');
  setTimeout(() => host.classList.remove('is-pulse'), 360);
}

let karaokeDragBound = false;
function bindKaraokeDrag() {
  if (karaokeDragBound) return;
  const host = $('#karaoke') as HTMLElement | null;
  const handle = $('#karaokeHandle') as HTMLElement | null;
  if (!host || !handle) return;
  karaokeDragBound = true;

  try {
    const raw = localStorage.getItem('bz:karaoke:pos');
    if (raw) {
      const p = JSON.parse(raw) as { x: number; y: number };
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
        host.style.left = `${p.x}px`;
        host.style.top = `${p.y}px`;
        host.style.right = 'auto';
        host.style.bottom = 'auto';
        host.style.transform = 'none';
      }
    }
  } catch { /* private mode */ }

  let dragging = false;
  let startX = 0; let startY = 0;
  let origLeft = 0; let origTop = 0;

  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = host.getBoundingClientRect();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const nx = Math.max(8, Math.min(vw - rect.width - 8, origLeft + dx));
    const ny = Math.max(8, Math.min(vh - rect.height - 8, origTop + dy));
    host.style.left = `${nx}px`;
    host.style.top = `${ny}px`;
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.transform = 'none';
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('is-dragging');
    host.classList.remove('is-dragging');
    try { handle.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    const rect = host.getBoundingClientRect();
    try { localStorage.setItem('bz:karaoke:pos', JSON.stringify({ x: rect.left, y: rect.top })); } catch { /* noop */ }
  };
  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging = true;
    const rect = host.getBoundingClientRect();
    // Lock to absolute pixel coords so transform-based centering doesn't fight the drag.
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;
    host.style.right = 'auto';
    host.style.bottom = 'auto';
    host.style.transform = 'none';
    origLeft = rect.left;
    origTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;
    handle.classList.add('is-dragging');
    host.classList.add('is-dragging');
    try { handle.setPointerCapture(e.pointerId); } catch { /* noop */ }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    e.preventDefault();
  });
  // Double-click handle to reset to default position.
  handle.addEventListener('dblclick', () => {
    host.style.removeProperty('left');
    host.style.removeProperty('top');
    host.style.removeProperty('right');
    host.style.removeProperty('bottom');
    host.style.removeProperty('transform');
    try { localStorage.removeItem('bz:karaoke:pos'); } catch { /* noop */ }
  });
}

/**
 * Toggle the center-screen karaoke overlay. Persists preference to localStorage.
 */
function setKaraokeOverlay(on: boolean) {
  karaokeOverlayOn = on;
  try { localStorage.setItem('bz:karaoke:overlay', on ? '1' : '0'); } catch { /* private mode */ }
  const host = $('#karaoke') as HTMLElement | null;
  if (host) host.hidden = !on;
  const btn = $('#btnLyricsOverlay') as HTMLButtonElement | null;
  if (btn) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on) bindKaraokeDrag();
  if (on && activeLyrics) {
    karaokeLastIdx = -2;
    paintKaraokeOverlay(Math.max(0, lyricsLastLineIdx), activeLyrics);
  }
}

function spawnRipple(host: HTMLElement, e: MouseEvent) {
  const r = host.getBoundingClientRect();
  const el = document.createElement('span');
  el.className = 'trackrow-ripple';
  el.style.left = `${e.clientX - r.left}px`;
  el.style.top = `${e.clientY - r.top}px`;
  host.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch =>
    ch === '&' ? '&amp;'
    : ch === '<' ? '&lt;'
    : ch === '>' ? '&gt;'
    : ch === '"' ? '&quot;'
    : '&#39;');
}

/**
 * Capitalize the first alphabetic character of a lyric line plus the first
 * alphabetic character after sentence-ending punctuation. Preserves existing
 * casing for proper nouns, acronyms, slang spellings (cuz it ain't on me).
 */
function capitalizeLyricLine(s: string): string {
  if (!s) return s;
  let out = s.replace(/^(\s*['"`(]*)([a-z])/, (_m, p, c) => p + c.toUpperCase());
  out = out.replace(/([.!?]\s+['"`(]*)([a-z])/g, (_m, p, c) => p + c.toUpperCase());
  return out;
}

async function play(track: Track) {
  pushTrackUrl(track);
  recordPlayStart(track.id);
  const doUpdate = () => {
    currentTrackId = track.id;
    renderAlbums($('#albums')!);
    renderNowPlaying(track);
    refreshShareLabel();
    refreshAiPlaylist();
  };
  const doc = document as Document & { startViewTransition?: (fn: () => void) => unknown };
  if (doc.startViewTransition) {
    doc.startViewTransition(doUpdate);
  } else {
    doUpdate();
  }
  if (cast.active) {
    if (cast.customChannelOpen) {
      // Receiver owns the queue; just tell it which track to play. Falls back
      // to standard CAF loadMedia if the custom message fails.
      cast.selectItem(track.id, 0).catch(() => {
        const album = ALBUM_BY_ID.get(track.album);
        cast.loadTrack(track, album?.cover ?? '/art/cover-panda-desiiignare.png', album?.name ?? 'bZ', 0).catch(() => engine.play(track));
      });
    } else {
      const album = ALBUM_BY_ID.get(track.album);
      cast.loadTrack(track, album?.cover ?? '/art/cover-panda-desiiignare.png', album?.name ?? 'bZ', 0).catch(() => engine.play(track));
    }
    startCastMirror(track);
  } else {
    engine.play(track);
  }
  updateMediaSession(track);
  scrollCurrentIntoView();
  showWisdomToast(track);
  trackRecent(track.id);
  applyAlbumPalette(track);
  if (npPanelOpen) refreshNpPanel();
  if (lyricsFsOpen) refreshLyricsFs();
  if (queuePanelOpen) {
    const activeTab = document.querySelector<HTMLButtonElement>('.queue-panel__tab.is-active');
    renderQueueTab(activeTab?.dataset.tab ?? 'up-next');
  }
  if (pipController?.isOpen()) refreshPipState();
  if (pendingDeeplinkSeek !== null) {
    const seek = pendingDeeplinkSeek;
    pendingDeeplinkSeek = null;
    const onMeta = () => {
      engine.audio.currentTime = Math.min(seek, engine.audio.duration || seek);
      engine.audio.removeEventListener('loadedmetadata', onMeta);
    };
    engine.audio.addEventListener('loadedmetadata', onMeta);
  }
  activeLyrics = null;
  activeLyrics = await loadLyrics(track);
  setTimeout(preloadNextTrack, 1500);
}

function scrollCurrentIntoView() {
  const el = $('.trackrow.is-current');
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateMediaSession(track: Track) {
  if (!('mediaSession' in navigator)) return;
  const album = ALBUM_BY_ID.get(track.album);
  const cover = new URL(album?.cover ?? '/art/logo.png', location.href).toString();
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: album?.name ?? 'bZ',
    artwork: [96, 192, 256, 384, 512].map(size => ({
      src: cover,
      sizes: `${size}x${size}`,
      type: 'image/png'
    }))
  });
}

function bindMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', () => {
    if (cast.active) cast.togglePlayPause();
    else engine.toggle();
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    if (cast.active) cast.togglePlayPause();
    else engine.toggle();
  });
  navigator.mediaSession.setActionHandler('previoustrack', () => nextTrack(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack(1));
  navigator.mediaSession.setActionHandler('seekbackward', d => {
    const next = Math.max(0, engine.audio.currentTime - (d?.seekOffset ?? 10));
    engine.audio.currentTime = next;
    if (cast.active) cast.seek(next);
  });
  navigator.mediaSession.setActionHandler('seekforward', d => {
    const next = Math.min(engine.audio.duration || 0, engine.audio.currentTime + (d?.seekOffset ?? 10));
    engine.audio.currentTime = next;
    if (cast.active) cast.seek(next);
  });
  navigator.mediaSession.setActionHandler('seekto', d => {
    if (typeof d.seekTime !== 'number') return;
    engine.audio.currentTime = d.seekTime;
    if (cast.active) cast.seek(d.seekTime);
  });
  engine.audio.addEventListener('play', () => setMediaSessionPlaybackState(true));
  engine.audio.addEventListener('pause', () => setMediaSessionPlaybackState(false));
  engine.audio.addEventListener('loadedmetadata', () => setMediaSessionPosition(engine.audio));
  engine.audio.addEventListener('seeked', () => setMediaSessionPosition(engine.audio));
  engine.audio.addEventListener('ratechange', () => setMediaSessionPosition(engine.audio));
  let lastPosWrite = 0;
  engine.audio.addEventListener('timeupdate', () => {
    const now = performance.now();
    recordListenProgress(engine.audio.currentTime || 0);
    if (now - lastPosWrite < 1000) return;
    lastPosWrite = now;
    setMediaSessionPosition(engine.audio);
  });
  engine.audio.addEventListener('ended', () => recordTrackEnded());
}

function bindIntegrations() {
  const castBtn = $('#btnCast') as HTMLButtonElement | null;
  const castLbl = $('#btnCastLabel');
  const airplayBtn = $('#btnAirplay') as HTMLButtonElement | null;
  const volInput = $('#vol') as HTMLInputElement | null;
  const playIcon = $('#playIcon');

  cast.on(e => {
    if (e.type === 'available') {
      // Keep the cast button visible even when unavailable — click then
      // surfaces an inline message instead of leaving the UI silently
      // missing the affordance. SDK readiness only re-styles the button.
      if (castBtn) {
        castBtn.hidden = false;
        castBtn.classList.toggle('is-ready', e.available);
        if (!e.available) {
          castBtn.setAttribute('title', 'Cast unavailable — Chrome desktop or Android Chrome required');
        } else {
          castBtn.setAttribute('title', 'Cast to TV / speaker (Chromecast)');
        }
      }
    } else if (e.type === 'session') {
      if (!castBtn) return;
      castBtn.classList.toggle('is-active', e.active);
      castBtn.setAttribute('aria-pressed', e.active ? 'true' : 'false');
      if (castLbl) castLbl.textContent = e.active ? (e.deviceName ? `→ ${e.deviceName}` : 'casting') : 'cast';
      castBtn.setAttribute('title', e.active ? `Casting to ${e.deviceName ?? 'device'} — click for remote` : 'Cast to TV / speaker (Chromecast)');
      document.body.classList.toggle('is-casting', e.active);
      if (e.active) {
        if (currentTrackId) {
          const t = TRACK_BY_ID.get(currentTrackId);
          const album = t ? ALBUM_BY_ID.get(t.album) : null;
          if (t && album) cast.loadTrack(t, album.cover, album.name, engine.audio.currentTime || 0).catch(() => { /* noop */ });
          if (t) startCastMirror(t);
        }
        // Push the full TRACKS list so the receiver can render+navigate the
        // identical playlist with the TV remote. Runs after openCustomChannel
        // resolves; sendCustom queues until then so this is safe to call here.
        pushCastQueue(currentTrackId, engine.audio.currentTime || 0, !engine.audio.paused);
        openCastSheet();
      } else {
        stopCastMirror();
        closeCastSheet();
      }
    } else if (e.type === 'receiver-state') {
      mirrorReceiverState(e.state);
    } else if (e.type === 'connection') {
      updateCastStatusIndicator(e.status, e.reason);
    } else if (e.type === 'receiver-error') {
      console.warn('[receiver]', e.code, e.message);
    } else if (e.type === 'receiver-log') {
      if (e.level === 'error') console.error('[receiver]', e.tag, e.message);
      else if (e.level === 'warn') console.warn('[receiver]', e.tag, e.message);
      else console.log('[receiver]', e.tag, e.message);
    } else if (e.type === 'state') {
      if (playIcon) {
        playIcon.innerHTML = e.playing
          ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
          : '<polygon points="6 3 20 12 6 21 6 3"/>';
      }
      syncCastSheetPlayState(e.playing);
      syncMirrorPlayState(e.playing);
    } else if (e.type === 'volume') {
      if (volInput) volInput.value = e.level.toString();
      syncCastSheetVolume(e.level, e.muted);
    } else if (e.type === 'progress') {
      const totalEl = $('#transportTotal');
      const nowEl = $('#transportNow');
      if (nowEl) nowEl.textContent = fmtClock(e.currentTime);
      if (totalEl && e.duration > 0) totalEl.textContent = fmtClock(e.duration);
      const fill = $('#transportFill');
      if (fill && e.duration > 0) fill.style.width = `${(e.currentTime / e.duration) * 100}%`;
      syncCastSheetProgress(e.currentTime, e.duration);
      syncMirrorPosition(e.currentTime);
    } else if (e.type === 'loaded') {
      syncCastSheetTrack(e.title, e.artist, e.album, e.cover);
    } else if (e.type === 'ended') {
      // queueAdvance triggers the next track via its own callback
    } else if (e.type === 'error') {
      console.warn('[cast]', e.message);
    }
  });

  cast.setQueueAdvance(() => nextTrack(1));

  const castLauncher = $('#castLauncher') as HTMLElement | null;
  // SDK-canonical pattern: overlay <google-cast-launcher> over #btnCast so REAL
  // trusted clicks land on the launcher (its internal handler bypasses Chrome's
  // Remote Playback fallback). Synthetic .click() dispatch fails isTrusted=false
  // check on Chrome ≥126 desktop — that's why earlier proxy approach defaulted
  // to the macOS Media Session widget instead of the Cast picker. Pointer-events
  // gated on SDK-ready state so SDK-not-loaded clicks still hit our button.
  const armLauncher = () => {
    if (!castLauncher) return;
    if (cast.available && !cast.active) castLauncher.style.pointerEvents = 'auto';
    else castLauncher.style.pointerEvents = 'none';
  };
  customElements.whenDefined('google-cast-launcher').then(armLauncher);
  cast.on(() => armLauncher());

  castBtn?.addEventListener('click', () => {
    if (cast.active) { openCastSheet(); return; }
    if (cast.available) {
      // Direct framework call as a defensive second path — if the launcher
      // overlay caught the click (real trusted event), this never reaches here
      // because the launcher's handler stopped propagation. If we DO reach
      // here, either the launcher wasn't armed yet (race) or it's a keyboard
      // activation — both safe to handle via ctx.requestSession() synchronously.
      cast.requestSession();
      return;
    }
    // SDK not loaded yet OR no Cast support in this browser.
    if (!cast.loaded) {
      cast.init();
      castBtn.setAttribute('title', 'Loading Cast SDK — click again in a moment');
      castBtn.classList.add('is-loading');
      // Drop the loading badge once availability resolves so the next click
      // shows the picker. The waitForCastAvailable helper survives across
      // the deferred init → fires when window.__onGCastApiAvailable runs.
      waitForCastAvailable(4000).then(ready => {
        castBtn.classList.remove('is-loading');
        if (ready) castBtn.setAttribute('title', 'Cast to TV / speaker (Chromecast)');
        else {
          castBtn.classList.add('is-unavailable');
          castBtn.setAttribute('title', 'Cast unavailable — Chrome desktop or Android Chrome required');
        }
      });
      return;
    }
    castBtn.classList.add('is-unavailable');
    castBtn.setAttribute('title', 'Cast unavailable — Chrome desktop or Android Chrome required');
  });

  bindCastSheet();

  airplayAvailable(engine.audio).then(ok => {
    if (ok && airplayBtn) airplayBtn.hidden = false;
  });
  airplayBtn?.addEventListener('click', () => showAirPlayPicker(engine.audio));

  setupDocumentPip();

  // Eager-load Cast framework immediately so the picker is ready by the time
  // the user clicks. Script is async + off-origin (gstatic.com), so it never
  // blocks initial paint — but starts discovering devices ASAP. Calling init()
  // is idempotent; the bridge guards against double-load internally.
  cast.init();

  // Wake-lock during full-screen lyrics / karaoke mode
  document.addEventListener('lyricsfs:open', () => { acquireWakeLock(); });
  document.addEventListener('lyricsfs:close', () => { releaseWakeLock(); });
}

function waitForCastAvailable(timeoutMs: number): Promise<boolean> {
  if (cast.available) return Promise.resolve(true);
  return new Promise(resolve => {
    let done = false;
    const off = cast.on(e => {
      if (e.type !== 'available') return;
      if (done) return;
      done = true;
      off();
      resolve(e.available);
    });
    setTimeout(() => {
      if (done) return;
      done = true;
      off();
      resolve(cast.available);
    }, timeoutMs);
  });
}

function setupDocumentPip(): void {
  const btn = $('#btnPip') as HTMLButtonElement | null;
  if (!btn) return;
  const supported = 'documentPictureInPicture' in window;
  if (!supported) return;
  btn.hidden = false;

  pipController = createPipController({
    onPlayPause: () => {
      if (cast.active) {
        cast.togglePlayPause();
      } else if (engine.audio.paused) {
        if (currentTrackId) {
          const t = TRACK_BY_ID.get(currentTrackId);
          if (t) void engine.play(t);
        }
      } else {
        engine.audio.pause();
      }
    },
    onPrev: () => nextTrack(-1),
    onNext: () => nextTrack(1),
    onSeek: (seconds: number) => {
      engine.audio.currentTime = seconds;
      if (cast.active) cast.seek(seconds);
    }
  });

  btn.addEventListener('click', () => {
    btn.classList.toggle('is-active');
    void pipController?.toggle().then(() => {
      btn.classList.toggle('is-active', pipController?.isOpen() ?? false);
      if (pipController?.isOpen()) refreshPipState();
    });
  });

  engine.audio.addEventListener('play', () => pipController?.syncPlayState(true));
  engine.audio.addEventListener('pause', () => pipController?.syncPlayState(false));
  engine.audio.addEventListener('timeupdate', () => {
    pipController?.syncProgress(engine.audio.currentTime || 0, engine.audio.duration || 0);
  });
  engine.audio.addEventListener('loadedmetadata', () => {
    pipController?.syncProgress(engine.audio.currentTime || 0, engine.audio.duration || 0);
  });
}

function refreshPipState(): void {
  if (!pipController?.isOpen()) return;
  const t = currentTrackId ? TRACK_BY_ID.get(currentTrackId) : null;
  if (t) {
    const album = ALBUM_BY_ID.get(t.album);
    pipController.syncTrack({
      title: t.title,
      artist: t.artist,
      cover: album?.cover ?? '/art/cover-panda-desiiignare.png',
      album: album?.name ?? 'bZ'
    });
  }
  const styles = getComputedStyle(document.documentElement);
  pipController.syncPalette({
    bg: styles.getPropertyValue('--bg').trim() || '#06030f',
    ink: styles.getPropertyValue('--ink').trim() || '#f4ecd8',
    accent: styles.getPropertyValue('--accent').trim() || '#a586ff'
  });
  pipController.syncPlayState(!engine.audio.paused);
  pipController.syncProgress(engine.audio.currentTime || 0, engine.audio.duration || 0);
}

// ─────────────────────────── Cast sheet + mirror ───────────────────────────
// Web Audio API stays alive while casting by mirroring the same MP3 locally
// at volume 0 + muted. AnalyserNode keeps producing real frequency data
// driving the cast-sheet visualizer. Receiver streams the source URL itself.

let mirrorSavedVolume = 0.85;
let mirrorActive = false;
let castVizRaf = 0;
let castSeekDrag = false;

type CastVizMode = 'bars' | 'circle' | 'particles';
let castVizMode: CastVizMode = (localStorage.getItem('bz:cast-viz') as CastVizMode | null) ?? 'bars';
let castPalette: Palette | null = null;
let castLyricsLines: CastLine[] = [];
let castLyricsLineEls: HTMLParagraphElement[] = [];
let castLyricsWordSpans: HTMLSpanElement[][] = [];
let castLyricsLastIdx = -2;
let castLyricsLastWordIdx = -2;
let castParticles: Array<{ x: number; y: number; vx: number; vy: number; life: number; max: number; hue: number }> = [];
const CAST_VIZ_LABELS: Record<CastVizMode, string> = { bars: 'Bars', circle: 'Radial', particles: 'Particles' };

function startCastMirror(track: Track): void {
  const a = engine.audio;
  if (!mirrorActive) {
    mirrorSavedVolume = a.volume;
    mirrorActive = true;
  }
  a.muted = true;
  a.volume = 0;
  if (engine.current?.id !== track.id) {
    engine.current = track;
    a.src = track.file;
  }
  a.play().catch(() => { /* autoplay can fail on some platforms — viz then runs only when user gesture wakes it */ });
}

function stopCastMirror(): void {
  if (!mirrorActive) return;
  mirrorActive = false;
  const a = engine.audio;
  a.muted = false;
  a.volume = mirrorSavedVolume;
  try { a.pause(); } catch { /* noop */ }
}

function tracksToCastItems(list: Track[]): ReceiverQueueItem[] {
  return list.map(t => {
    const album = ALBUM_BY_ID.get(t.album);
    const cover = album?.cover ?? '/art/cover-panda-desiiignare.png';
    return {
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: album?.name ?? 'bZ',
      cover: new URL(cover, location.href).toString(),
      audio: new URL(t.file, location.href).toString(),
      vibe: t.vibe
    };
  });
}

function pushCastQueue(startTrackId: string | null, startPosition = 0, autoplay = true): void {
  if (!cast.customChannelOpen) return;
  const items = tracksToCastItems(TRACKS);
  const startIndex = startTrackId
    ? Math.max(0, TRACKS.findIndex(x => x.id === startTrackId))
    : 0;
  cast.loadQueue(items, { startIndex, startPosition, autoplay, shuffle: shuffleOn, loop: loopMode })
    .catch(err => console.warn('[cast] queue load failed', err));
}

function paletteToCastPayload(p: Palette): PalettePayload {
  const swatches = p.rgb.slice(0, 4).map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`);
  const [vr, vg, vb] = p.vibrant;
  const [mr, mg, mb] = p.muted;
  return {
    bg: swatches[0] ?? '#06030f',
    ink: p.ink,
    accent: p.accent,
    vibrant: `rgb(${vr}, ${vg}, ${vb})`,
    muted: `rgb(${mr}, ${mg}, ${mb})`,
    swatches
  };
}

function mirrorReceiverState(state: ReceiverState): void {
  // Receiver is the source of truth when custom channel is live. Reflect changes
  // in the website UI without re-broadcasting (would create a feedback loop).
  if (state.trackId && state.trackId !== currentTrackId) {
    const t = TRACK_BY_ID.get(state.trackId);
    if (t) {
      currentTrackId = t.id;
      renderAlbums($('#albums')!);
      renderNowPlaying(t);
      refreshShareLabel();
      const album = ALBUM_BY_ID.get(t.album);
      if (album) syncCastSheetTrack(t.title, t.artist, album.name, album.cover);
      applyAlbumPalette(t);
      if (npPanelOpen) refreshNpPanel();
      if (queuePanelOpen) {
        const activeTab = document.querySelector<HTMLButtonElement>('.queue-panel__tab.is-active');
        renderQueueTab(activeTab?.dataset.tab ?? 'up-next');
      }
    }
  }
  cast.isPlaying = state.playing;
  cast.volumeLevel = state.volume;
  cast.muted = state.muted;
  syncCastSheetPlayState(state.playing);
  syncCastSheetVolume(state.volume, state.muted);
  syncMirrorPlayState(state.playing);
  syncCastSheetProgress(state.position, state.duration);
  syncMirrorPosition(state.position);
}

function updateCastStatusIndicator(status: 'live' | 'stale' | 'error', reason?: string): void {
  const dot = document.querySelector<HTMLElement>('.cast-sheet__pill-dot');
  const txt = $('#castPillText');
  if (dot) {
    dot.dataset.status = status;
  }
  if (txt) {
    txt.textContent = status === 'live' ? 'Casting' : status === 'stale' ? 'Reconnecting…' : 'Error';
    if (reason) txt.title = reason;
  }
  document.body.dataset.castStatus = status;
}

function syncMirrorPlayState(playing: boolean): void {
  if (!mirrorActive) return;
  const a = engine.audio;
  if (playing && a.paused) a.play().catch(() => { /* noop */ });
  else if (!playing && !a.paused) { try { a.pause(); } catch { /* noop */ } }
}

function syncMirrorPosition(receiverTime: number): void {
  if (!mirrorActive) return;
  const a = engine.audio;
  if (!Number.isFinite(a.duration) || a.duration <= 0) return;
  const drift = Math.abs(a.currentTime - receiverTime);
  if (drift > 1.5) a.currentTime = Math.min(receiverTime, a.duration - 0.1);
}

function openCastSheet(): void {
  const dlg = $('#castSheet') as HTMLDialogElement | null;
  if (!dlg) return;
  if (cast.deviceName) {
    const nameEl = $('#castDeviceName');
    if (nameEl) nameEl.textContent = cast.deviceName;
  }
  refreshCastSheetFromState();
  renderCastQueue();
  refreshCastHueUI();
  applyCastVizModeUI();
  if (!dlg.open) {
    try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
  }
  dlg.classList.add('is-open');
  document.body.classList.add('cast-tv-open');
  startCastVizLoop();
  startCastLyricsLoop();
}

function closeCastSheet(): void {
  const dlg = $('#castSheet') as HTMLDialogElement | null;
  if (!dlg) return;
  dlg.classList.remove('is-open');
  document.body.classList.remove('cast-tv-open');
  if (dlg.open) { try { dlg.close(); } catch { dlg.removeAttribute('open'); } }
  stopCastVizLoop();
  stopCastLyricsLoop();
  closeCastSettings();
  hue.setOn(false).catch(() => { /* noop */ });
}

function refreshCastSheetFromState(): void {
  const load = cast.currentLoad();
  if (load) syncCastSheetTrack(load.title, load.artist, load.album, load.cover);
  else if (currentTrackId) {
    const t = TRACK_BY_ID.get(currentTrackId);
    const album = t ? ALBUM_BY_ID.get(t.album) : null;
    if (t && album) syncCastSheetTrack(t.title, t.artist, album.name, album.cover);
  }
  syncCastSheetVolume(cast.volumeLevel, cast.muted);
  syncCastSheetPlayState(cast.isPlaying);
  const nameEl = $('#castDeviceName');
  if (nameEl && cast.deviceName) nameEl.textContent = cast.deviceName;
}

function syncCastSheetTrack(title: string, artist: string, album: string, cover: string): void {
  const titleEl = $('#castTitle');
  const subEl = $('#castSubtitle');
  const albumEl = $('#castAlbum');
  const coverEl = $('#castCover') as HTMLImageElement | null;
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = artist;
  if (albumEl) albumEl.textContent = album;
  if (coverEl && coverEl.getAttribute('src') !== cover) coverEl.src = cover;
  refreshCastPalette(cover);
  const t = currentTrackId ? TRACK_BY_ID.get(currentTrackId) : null;
  if (t) refreshCastLyrics(t);
  renderCastQueue();
}

async function refreshCastPalette(coverSrc: string): Promise<void> {
  try {
    const p = await extractPalette(coverSrc);
    castPalette = p;
    hue.setPalette(p.rgb.length ? p.rgb : [p.vibrant, p.muted]);
    // Every visualizer mode now inherits this album's colors — no two tracks
    // look identical. Also exposes palette as CSS custom props so the lyrics
    // glow + chrome can match.
    visualizer?.setPalette(p);
    document.documentElement.style.setProperty('--track-vibrant', p.vibrantHex);
    document.documentElement.style.setProperty('--track-muted', p.mutedHex);
    document.documentElement.style.setProperty('--track-complementary', p.complementaryHex);
    document.documentElement.style.setProperty('--track-dark-vibrant', p.darkVibrantHex);
    document.documentElement.style.setProperty('--track-light-muted', p.lightMutedHex);
    document.documentElement.style.setProperty('--track-vibrant-p3', p.vibrantP3);
    document.documentElement.style.setProperty('--track-vibrant-oklch', p.vibrantOklch);
    if (cast.customChannelOpen) {
      cast.setPalette(paletteToCastPayload(p)).catch(() => { /* noop */ });
    }
    const dlg = $('#castSheet') as HTMLDialogElement | null;
    if (!dlg) return;
    const [vr, vg, vb] = p.vibrant;
    const [mr, mg, mb] = p.muted;
    const [s0, s1, s2, s3] = p.rgb;
    dlg.style.setProperty('--cast-accent', p.accent);
    dlg.style.setProperty('--cast-vibrant', `rgb(${vr}, ${vg}, ${vb})`);
    dlg.style.setProperty('--cast-muted', `rgb(${mr}, ${mg}, ${mb})`);
    dlg.style.setProperty('--cast-ink', p.ink);
    dlg.style.setProperty('--cast-bg-a', `rgba(${s0[0]}, ${s0[1]}, ${s0[2]}, 0.96)`);
    dlg.style.setProperty('--cast-bg-b', `rgba(${s1[0]}, ${s1[1]}, ${s1[2]}, 0.92)`);
    dlg.style.setProperty('--cast-bg-c', `rgba(${(s2 || s0)[0]}, ${(s2 || s0)[1]}, ${(s2 || s0)[2]}, 0.85)`);
    dlg.style.setProperty('--cast-bg-d', `rgba(${(s3 || s0)[0]}, ${(s3 || s0)[1]}, ${(s3 || s0)[2]}, 0.78)`);
  } catch { /* keep prior palette */ }
}

async function refreshCastLyrics(track: Track): Promise<void> {
  castLyricsLines = [];
  castLyricsLastIdx = -2;
  castLyricsLastWordIdx = -2;
  castLyricsLineEls = [];
  castLyricsWordSpans = [];
  const empty = $('#castLyricsEmpty');
  if (empty) empty.textContent = 'Lyrics syncing…';
  try {
    const bundle = await loadLyrics(track);
    castLyricsLines = bundle.lines.map((l, i) => {
      const words: CastWord[] = bundle.words
        ? bundle.words
            .filter(w => (w.line ?? -1) === i)
            .map(w => ({ w: w.w, s: w.s, e: w.e }))
        : [];
      return { t: l.s, e: l.e, text: capitalizeLyricLine(l.text), words };
    });
    renderCastLyricsList();
    if (cast.customChannelOpen) {
      const lines: ReceiverLine[] = castLyricsLines.map(l => ({
        t: l.t,
        e: l.e,
        text: l.text,
        words: l.words.length ? l.words.map(w => ({ w: w.w, s: w.s, e: w.e })) : undefined
      }));
      cast.setLyrics(track.id, lines).catch(() => { /* noop */ });
    }
  } catch {
    if (empty) empty.textContent = 'Lyrics unavailable.';
    if (cast.customChannelOpen) {
      cast.setLyrics(track.id, []).catch(() => { /* noop */ });
    }
  }
}

function castActiveLineIndex(lines: CastLine[], time: number): number {
  if (!lines.length) return -1;
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= time) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

function renderCastLyricsList(): void {
  const container = $('#castLyrics');
  if (!container) return;
  if (!castLyricsLines.length) {
    container.innerHTML = '<p class="cast-tv__lyrics-empty" id="castLyricsEmpty">Lyrics unavailable.</p>';
    castLyricsLineEls = [];
    castLyricsWordSpans = [];
    return;
  }
  container.innerHTML = '';
  castLyricsWordSpans = [];
  castLyricsLineEls = castLyricsLines.map((l, i) => {
    const p = document.createElement('p');
    p.className = 'cast-tv__line';
    p.dataset.idx = String(i);
    if (l.words.length) {
      p.innerHTML = l.words
        .map((w, wi) => `<span class="cast-tv__w" data-idx="${wi}">${escapeHtml(w.w)}</span>`)
        .join(' ');
      castLyricsWordSpans[i] = Array.from(p.querySelectorAll<HTMLSpanElement>('.cast-tv__w'));
    } else {
      p.textContent = l.text;
      castLyricsWordSpans[i] = [];
    }
    p.addEventListener('click', () => {
      engine.audio.currentTime = l.t;
      cast.seek(l.t);
    });
    container.appendChild(p);
    return p;
  });
}

function renderCastQueue(): void {
  const list = $('#castQueue');
  if (!list) return;
  const idx = currentTrackId ? TRACKS.findIndex(t => t.id === currentTrackId) : -1;
  const start = Math.max(0, idx);
  const upcoming: Track[] = [];
  const total = Math.min(8, TRACKS.length);
  for (let i = 0; i < total; i++) {
    upcoming.push(TRACKS[(start + i) % TRACKS.length]);
  }
  list.innerHTML = '';
  upcoming.forEach((t, i) => {
    const album = ALBUM_BY_ID.get(t.album);
    const li = document.createElement('li');
    li.className = i === 0 ? 'cast-tv__queue-item is-now' : 'cast-tv__queue-item';
    li.dataset.id = t.id;
    li.innerHTML = `
      <img class="cast-tv__queue-cover" src="${album?.cover ?? '/art/cover-panda-desiiignare.png'}" alt="" width="44" height="44" loading="lazy" />
      <div class="cast-tv__queue-text">
        <strong>${escapeHtml(t.title)}</strong>
        <span>${escapeHtml(t.artist)}${album ? ' · ' + escapeHtml(album.name) : ''}</span>
      </div>
      <span class="cast-tv__queue-tag">${i === 0 ? 'NOW' : String(i)}</span>
    `;
    li.addEventListener('click', () => {
      const target = TRACK_BY_ID.get(t.id);
      if (target && target.id !== currentTrackId) play(target);
    });
    list.appendChild(li);
  });
}

function syncCastSheetPlayState(playing: boolean): void {
  const icon = $('#castPlayIcon');
  if (icon) {
    icon.innerHTML = playing
      ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
      : '<polygon points="6 3 20 12 6 21 6 3"/>';
  }
  const dlg = $('#castSheet') as HTMLDialogElement | null;
  dlg?.classList.toggle('is-playing', playing);
}

function syncCastSheetVolume(level: number, muted: boolean): void {
  const range = $('#castVol') as HTMLInputElement | null;
  const pct = $('#castVolPct');
  const muteBtn = $('#castMute') as HTMLButtonElement | null;
  if (range && !range.matches(':active')) range.value = String(level);
  if (pct) pct.textContent = `${Math.round((muted ? 0 : level) * 100)}%`;
  if (muteBtn) muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  muteBtn?.classList.toggle('is-muted', muted);
}

function syncCastSheetProgress(currentTime: number, duration: number): void {
  if (castSeekDrag) return;
  const now = $('#castNow');
  const total = $('#castTotal');
  const fill = $('#castFill') as HTMLElement | null;
  const thumb = $('#castThumb') as HTMLElement | null;
  const bar = $('#castBar') as HTMLElement | null;
  if (now) now.textContent = fmtClock(currentTime);
  if (total && duration > 0) total.textContent = fmtClock(duration);
  const ratio = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
  if (fill) fill.style.width = `${ratio * 100}%`;
  if (thumb) thumb.style.left = `${ratio * 100}%`;
  if (bar) bar.setAttribute('aria-valuenow', ratio.toFixed(3));
}

function startCastVizLoop(): void {
  if (castVizRaf) return;
  const canvas = $('#castViz') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
  };
  fit();
  const onResize = () => fit();
  window.addEventListener('resize', onResize, { passive: true });
  const tick = () => {
    if (!cast.active) { castVizRaf = 0; window.removeEventListener('resize', onResize); return; }
    engine.sample();
    drawCastViz(ctx, canvas.width, canvas.height);
    pulseCastArt();
    pulseCastHue();
    castVizRaf = requestAnimationFrame(tick);
  };
  castVizRaf = requestAnimationFrame(tick);
}

function stopCastVizLoop(): void {
  if (castVizRaf) { cancelAnimationFrame(castVizRaf); castVizRaf = 0; }
}

function bandEnergy(data: Uint8Array, lo: number, hi: number): number {
  if (!data.length) return 0;
  const a = Math.floor(data.length * lo);
  const b = Math.floor(data.length * hi);
  let s = 0;
  for (let i = a; i < b; i++) s += data[i];
  return (s / Math.max(1, b - a)) / 255;
}

function castAccentRgb(): [number, number, number] {
  return castPalette?.vibrant ?? [0, 229, 255];
}
function castMutedRgb(): [number, number, number] {
  return castPalette?.muted ?? [124, 58, 237];
}

function drawCastViz(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  const data = engine.freqData;
  if (!data.length) {
    const accent = castAccentRgb();
    ctx.strokeStyle = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.45)`;
    ctx.lineWidth = Math.max(1, h * 0.012);
    ctx.beginPath();
    const t = performance.now() * 0.002;
    for (let x = 0; x < w; x++) {
      const y = h * 0.5 + Math.sin(x * 0.04 + t) * h * 0.18 * (0.6 + 0.4 * Math.sin(t + x * 0.01));
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    return;
  }
  if (castVizMode === 'circle') drawCastCircle(ctx, w, h, data);
  else if (castVizMode === 'particles') drawCastParticles(ctx, w, h, data);
  else drawCastBars(ctx, w, h, data);
}

function drawCastBars(ctx: CanvasRenderingContext2D, w: number, h: number, data: Uint8Array): void {
  const bars = 96;
  const usable = Math.min(data.length, Math.floor(data.length * 0.75));
  const step = usable / bars;
  const gap = Math.max(1, w * 0.003);
  const bw = (w - gap * (bars - 1)) / bars;
  const accent = castAccentRgb();
  const muted = castMutedRgb();
  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.95)`);
  grad.addColorStop(0.55, `rgba(${Math.round((accent[0] + muted[0]) / 2)}, ${Math.round((accent[1] + muted[1]) / 2)}, ${Math.round((accent[2] + muted[2]) / 2)}, 0.9)`);
  grad.addColorStop(1, `rgba(${muted[0]}, ${muted[1]}, ${muted[2]}, 0.85)`);
  ctx.fillStyle = grad;
  for (let i = 0; i < bars; i++) {
    let s = 0;
    const a = Math.floor(i * step);
    const b = Math.floor((i + 1) * step);
    for (let j = a; j < b; j++) s += data[j];
    const v = (s / Math.max(1, b - a)) / 255;
    const eased = Math.pow(v, 1.4);
    const bh = Math.max(2, eased * h * 0.92);
    const x = i * (bw + gap);
    const y = h - bh;
    const r = Math.min(bw * 0.45, 4);
    roundRect(ctx, x, y, bw, bh, r);
    ctx.fill();
  }
  const pulse = engine.beatPulse;
  if (pulse > 0.05) {
    ctx.fillStyle = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, ${pulse * 0.22})`;
    ctx.fillRect(0, h - 4, w, 4);
  }
}

function drawCastCircle(ctx: CanvasRenderingContext2D, w: number, h: number, data: Uint8Array): void {
  const cx = w / 2;
  const cy = h / 2;
  const baseR = Math.min(w, h) * 0.22;
  const accent = castAccentRgb();
  const muted = castMutedRgb();
  const bands = 128;
  const step = Math.max(1, Math.floor(data.length * 0.65 / bands));
  const beat = engine.beatPulse;
  const inner = baseR * (1 + beat * 0.18);
  // background ring
  ctx.strokeStyle = `rgba(${muted[0]}, ${muted[1]}, ${muted[2]}, 0.18)`;
  ctx.lineWidth = Math.max(1, h * 0.005);
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.stroke();
  // spokes
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, h * 0.0085);
  for (let i = 0; i < bands; i++) {
    let s = 0;
    const a = i * step;
    const b = a + step;
    for (let j = a; j < b; j++) s += data[j];
    const v = (s / step) / 255;
    const len = Math.pow(v, 1.6) * (h * 0.42);
    const ang = (i / bands) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(ang) * inner;
    const y1 = cy + Math.sin(ang) * inner;
    const x2 = cx + Math.cos(ang) * (inner + len);
    const y2 = cy + Math.sin(ang) * (inner + len);
    const t = i / bands;
    const r = Math.round(accent[0] * (1 - t) + muted[0] * t);
    const g = Math.round(accent[1] * (1 - t) + muted[1] * t);
    const bcol = Math.round(accent[2] * (1 - t) + muted[2] * t);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${bcol}, ${0.55 + 0.4 * v})`;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  // halo
  if (beat > 0.05) {
    ctx.strokeStyle = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, ${beat * 0.5})`;
    ctx.lineWidth = Math.max(2, h * 0.012) * (1 + beat * 1.2);
    ctx.beginPath();
    ctx.arc(cx, cy, inner * (1.1 + beat * 0.2), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawCastParticles(ctx: CanvasRenderingContext2D, w: number, h: number, data: Uint8Array): void {
  const accent = castAccentRgb();
  const muted = castMutedRgb();
  const bass = bandEnergy(data, 0, 0.08);
  const mid = bandEnergy(data, 0.08, 0.4);
  const beat = engine.beatPulse;
  // Trail
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.fillRect(0, 0, w, h);
  // Spawn on beat or strong bass
  const spawnN = Math.round(beat * 12 + bass * 8);
  for (let i = 0; i < spawnN && castParticles.length < 220; i++) {
    const ang = Math.random() * Math.PI * 2;
    const speed = 1.4 + Math.random() * (3.2 + beat * 4);
    castParticles.push({
      x: w / 2 + (Math.random() - 0.5) * w * 0.05,
      y: h / 2 + (Math.random() - 0.5) * h * 0.4,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed * 0.6,
      life: 0,
      max: 60 + Math.random() * 60,
      hue: Math.random()
    });
  }
  // Update + draw
  const drag = 0.985;
  for (let i = castParticles.length - 1; i >= 0; i--) {
    const p = castParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= drag;
    p.vy *= drag;
    p.vy += 0.03;
    p.life += 1;
    if (p.life >= p.max || p.x < -10 || p.x > w + 10 || p.y > h + 10) {
      castParticles.splice(i, 1);
      continue;
    }
    const t = p.life / p.max;
    const alpha = (1 - t) * (0.7 + mid * 0.3);
    const col = p.hue < 0.5 ? accent : muted;
    const radius = 1.2 + (1 - t) * 3.2;
    ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, ${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  // BPM ribbon along the bottom for context
  ctx.strokeStyle = `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, 0.6)`;
  ctx.lineWidth = Math.max(1, h * 0.008);
  ctx.beginPath();
  const tNow = performance.now() * 0.003;
  for (let x = 0; x < w; x += 4) {
    const y = h - 14 - Math.sin(x * 0.02 + tNow) * 6 * (0.4 + bass);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function pulseCastArt(): void {
  const el = $('#castArtPulse');
  if (!el) return;
  const beat = engine.beatPulse;
  const bass = bandEnergy(engine.freqData, 0, 0.08);
  const scale = 1 + beat * 0.06 + bass * 0.025;
  const opacity = Math.min(1, 0.15 + beat * 0.85 + bass * 0.3);
  el.style.transform = `scale(${scale.toFixed(3)})`;
  el.style.opacity = opacity.toFixed(3);
  // BPM display
  const bpmEl = $('#castBpm');
  if (bpmEl && engine.bpm) bpmEl.textContent = String(Math.round(engine.bpm));
}

function pulseCastHue(): void {
  if (!hue.isReady()) return;
  const accent = castAccentRgb();
  const data = engine.freqData;
  const bass = bandEnergy(data, 0, 0.08);
  const mid = bandEnergy(data, 0.08, 0.4);
  const treble = bandEnergy(data, 0.4, 1);
  hue.pulse(accent, {
    bass, mid, treble,
    beat: engine.beatPulse,
    bpm: engine.bpm,
    dropImminent: engine.dropImminent,
    dropEnergy: engine.dropEnergy,
    buildPhase: engine.buildPhase
  }).catch(() => { /* swallow */ });
}

let castLyricsRaf = 0;
function startCastLyricsLoop(): void {
  if (castLyricsRaf) return;
  const tick = () => {
    if (!cast.active) { castLyricsRaf = 0; return; }
    tickCastLyrics();
    castLyricsRaf = requestAnimationFrame(tick);
  };
  castLyricsRaf = requestAnimationFrame(tick);
}
function stopCastLyricsLoop(): void {
  if (castLyricsRaf) { cancelAnimationFrame(castLyricsRaf); castLyricsRaf = 0; }
}

function tickCastLyrics(): void {
  if (!castLyricsLines.length || !castLyricsLineEls.length) return;
  const now = engine.audio.currentTime;
  const idx = castActiveLineIndex(castLyricsLines, now);
  if (idx !== castLyricsLastIdx) {
    if (castLyricsLastIdx >= 0) {
      const prevSpans = castLyricsWordSpans[castLyricsLastIdx];
      if (prevSpans) prevSpans.forEach(s => { s.classList.remove('is-active', 'is-past'); });
    }
    castLyricsLastIdx = idx;
    castLyricsLastWordIdx = -2;
    castLyricsLineEls.forEach((el, i) => {
      el.classList.toggle('is-active', i === idx);
      el.classList.toggle('is-past', i < idx);
      el.classList.toggle('is-soon', i === idx + 1);
    });
    const target = castLyricsLineEls[idx];
    if (target) {
      const container = $('#castLyrics');
      if (container) {
        const cr = container.getBoundingClientRect();
        const tr = target.getBoundingClientRect();
        const offset = (tr.top - cr.top) - cr.height / 2 + tr.height / 2;
        container.scrollBy({ top: offset, behavior: 'smooth' });
      }
    }
  }
  if (idx < 0) return;
  const line = castLyricsLines[idx];
  const spans = castLyricsWordSpans[idx];
  if (!line || !spans || !spans.length || !line.words.length) return;
  let wIdx = -1;
  for (let i = 0; i < line.words.length; i++) {
    const w = line.words[i];
    if (now >= w.s && now < w.e) { wIdx = i; break; }
    if (now < w.s) { wIdx = i - 1; break; }
  }
  if (wIdx === -1 && line.words.length && now >= line.words[line.words.length - 1].e) {
    wIdx = line.words.length - 1;
  }
  if (wIdx === castLyricsLastWordIdx) return;
  castLyricsLastWordIdx = wIdx;
  spans.forEach((s, i) => {
    s.classList.toggle('is-active', i === wIdx);
    s.classList.toggle('is-past', i < wIdx);
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ─── Cast settings: Hue, viz mode, fullscreen, about ───
function openCastSettings(): void {
  const el = $('#castSettings');
  if (!el) return;
  el.setAttribute('aria-hidden', 'false');
  el.classList.add('is-open');
}
function closeCastSettings(): void {
  const el = $('#castSettings');
  if (!el) return;
  el.setAttribute('aria-hidden', 'true');
  el.classList.remove('is-open');
}

function applyCastVizModeUI(): void {
  $$('.cast-seg').forEach(b => {
    const m = (b as HTMLElement).dataset.viz as CastVizMode | undefined;
    b.setAttribute('aria-pressed', m === castVizMode ? 'true' : 'false');
  });
  const lbl = $('#castVizModeLabel');
  if (lbl) lbl.textContent = CAST_VIZ_LABELS[castVizMode];
}

function setCastVizMode(m: CastVizMode): void {
  castVizMode = m;
  try { localStorage.setItem('bz:cast-viz', m); } catch { /* noop */ }
  if (m === 'particles') castParticles = [];
  applyCastVizModeUI();
}

function cycleCastVizMode(): void {
  const order: CastVizMode[] = ['bars', 'circle', 'particles'];
  setCastVizMode(order[(order.indexOf(castVizMode) + 1) % order.length]);
}

function refreshCastHueUI(): void {
  const indicator = $('#castHueIndicator');
  const indicatorLbl = $('#castHueIndicatorLabel');
  const groupRow = $('#castHueGroupRow');
  const intensityRow = $('#castHueIntensityRow');
  const enableRow = $('#castHueEnableRow');
  const groupSel = $('#castHueGroup') as HTMLSelectElement | null;
  const enableCb = $('#castHueEnable') as HTMLInputElement | null;
  const ipInput = $('#castHueIp') as HTMLInputElement | null;
  const intensityRange = $('#castHueIntensity') as HTMLInputElement | null;
  const intensityPct = $('#castHueIntensityPct');
  const errEl = $('#castHueError') as HTMLElement | null;
  const linked = Boolean(hue.config.bridgeIp && hue.config.appKey);
  if (groupRow) groupRow.hidden = !linked;
  if (intensityRow) intensityRow.hidden = !linked;
  if (enableRow) enableRow.hidden = !linked;
  const gradientRow = $('#castHueGradientRow') as HTMLElement | null;
  const gradientCb = $('#castHueGradient') as HTMLInputElement | null;
  const gradientStatus = $('#castHueGradientStatus');
  if (gradientRow) gradientRow.hidden = !linked;
  if (gradientCb) gradientCb.checked = hue.config.useGradient;
  if (gradientStatus) {
    const n = hue.gradientLights.length;
    gradientStatus.textContent = n
      ? `${n} gradient ${n === 1 ? 'light' : 'lights'} · ${hue.gradientLights.map(g => `${g.points}-zone ${g.name}`).join(', ')}`
      : 'No Light Bars / gradient strips paired';
  }
  if (ipInput && hue.config.bridgeIp) ipInput.value = hue.config.bridgeIp;
  if (intensityRange) intensityRange.value = String(hue.config.intensity);
  if (intensityPct) intensityPct.textContent = `${Math.round(hue.config.intensity * 100)}%`;
  if (enableCb) enableCb.checked = hue.config.enabled;
  if (groupSel) {
    groupSel.innerHTML = '';
    for (const g of hue.groups) {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.textContent = `${g.name}${g.type !== 'other' ? ' · ' + g.type : ''}`;
      if (g.id === hue.config.groupId) opt.selected = true;
      groupSel.appendChild(opt);
    }
  }
  const ready = hue.isReady();
  if (indicator) {
    indicator.setAttribute('aria-pressed', ready ? 'true' : 'false');
    indicator.classList.toggle('is-on', ready);
  }
  if (indicatorLbl) {
    indicatorLbl.textContent = !linked ? 'Hue'
      : !hue.config.groupId ? 'Pick group'
      : ready ? 'Hue on'
      : 'Hue paused';
  }
  if (errEl) {
    if (hue.lastError && hue.status === 'error') {
      errEl.textContent = hue.lastError;
      errEl.hidden = false;
    } else {
      errEl.textContent = '';
      errEl.hidden = true;
    }
  }
  const hint = $('#castHueHint') as HTMLElement | null;
  if (hint) {
    hint.textContent = hue.status === 'discovering' ? 'Searching the network…'
      : hue.status === 'linking' ? 'Press the round button on your bridge — linking now…'
      : !linked ? 'Sync your bulbs to the music — accent color, bass-driven brightness, beat flashes. Tap discover, then press the round button on your bridge.'
      : ready ? 'Synced. Adjust intensity below.'
      : 'Pick a Hue group to drive.';
  }
}

function bindCastHueControls(): void {
  hue.on(() => refreshCastHueUI());

  $('#castHueDiscover')?.addEventListener('click', async () => {
    const ipInput = $('#castHueIp') as HTMLInputElement | null;
    const found = await hue.discover();
    if (found.length && ipInput) ipInput.value = found[0].ip;
    refreshCastHueUI();
  });

  $('#castHueLink')?.addEventListener('click', async () => {
    const ipInput = $('#castHueIp') as HTMLInputElement | null;
    if (!ipInput?.value) return;
    const result = await hue.link(ipInput.value);
    if (result.ok) {
      await hue.loadGroups();
      await hue.loadGradientLights();
      // Pre-select first entertainment/room/zone
      const preferred = hue.groups.find(g => g.type === 'entertainment')
        ?? hue.groups.find(g => g.type === 'room')
        ?? hue.groups.find(g => g.type === 'zone')
        ?? hue.groups[1] ?? hue.groups[0];
      if (preferred) hue.setGroup(preferred.id);
      hue.setEnabled(true);
    }
    refreshCastHueUI();
  });

  $('#castHueGradient')?.addEventListener('change', e => {
    hue.setUseGradient((e.target as HTMLInputElement).checked);
    refreshCastHueUI();
  });

  $('#castHueGroup')?.addEventListener('change', e => {
    const v = (e.target as HTMLSelectElement).value;
    hue.setGroup(v);
    refreshCastHueUI();
  });

  $('#castHueIntensity')?.addEventListener('input', e => {
    hue.setIntensity(parseFloat((e.target as HTMLInputElement).value));
    const pct = $('#castHueIntensityPct');
    if (pct) pct.textContent = `${Math.round(hue.config.intensity * 100)}%`;
  });

  $('#castHueEnable')?.addEventListener('change', e => {
    hue.setEnabled((e.target as HTMLInputElement).checked);
    refreshCastHueUI();
  });

  $('#castHueUnlink')?.addEventListener('click', () => {
    hue.unlink();
    refreshCastHueUI();
  });

  $('#castHueIndicator')?.addEventListener('click', () => {
    if (!hue.config.bridgeIp || !hue.config.appKey) {
      openCastSettings();
      return;
    }
    hue.setEnabled(!hue.config.enabled);
    refreshCastHueUI();
  });
}

function $$(sel: string, root: Document | HTMLElement = document): HTMLElement[] {
  return Array.from(root.querySelectorAll(sel)) as HTMLElement[];
}

function bindCastSheet(): void {
  const dlg = $('#castSheet') as HTMLDialogElement | null;
  if (!dlg) return;
  $('#castSheetClose')?.addEventListener('click', () => closeCastSheet());
  $('#castStop')?.addEventListener('click', () => { cast.endSession(true); closeCastSheet(); });
  $('#castPlay')?.addEventListener('click', () => cast.togglePlayPause());
  $('#castPrev')?.addEventListener('click', () => nextTrack(-1));
  $('#castNext')?.addEventListener('click', () => nextTrack(1));
  $('#castSeekBack')?.addEventListener('click', () => {
    const a = engine.audio;
    const next = Math.max(0, a.currentTime - 10);
    a.currentTime = next;
    cast.seek(next);
  });
  $('#castSeekFwd')?.addEventListener('click', () => {
    const a = engine.audio;
    const next = Math.min(a.duration || 0, a.currentTime + 10);
    a.currentTime = next;
    cast.seek(next);
  });
  $('#castMute')?.addEventListener('click', () => cast.toggleMute());

  const range = $('#castVol') as HTMLInputElement | null;
  range?.addEventListener('input', () => {
    const v = parseFloat(range.value);
    cast.setVolume(v);
    syncCastSheetVolume(v, cast.muted);
  });

  const bar = $('#castBar') as HTMLElement | null;
  if (bar) {
    const seekFromEvent = (e: PointerEvent) => {
      const r = bar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const dur = engine.audio.duration || 0;
      const seconds = ratio * dur;
      const fill = $('#castFill') as HTMLElement | null;
      const thumb = $('#castThumb') as HTMLElement | null;
      const now = $('#castNow');
      if (fill) fill.style.width = `${ratio * 100}%`;
      if (thumb) thumb.style.left = `${ratio * 100}%`;
      if (now) now.textContent = fmtClock(seconds);
      return seconds;
    };
    bar.addEventListener('pointerdown', e => {
      castSeekDrag = true;
      bar.setPointerCapture(e.pointerId);
      seekFromEvent(e);
    });
    bar.addEventListener('pointermove', e => {
      if (!castSeekDrag) return;
      seekFromEvent(e);
    });
    bar.addEventListener('pointerup', e => {
      if (!castSeekDrag) return;
      const seconds = seekFromEvent(e);
      castSeekDrag = false;
      try { bar.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      engine.audio.currentTime = seconds;
      cast.seek(seconds);
    });
    bar.addEventListener('keydown', e => {
      const dur = engine.audio.duration || 0;
      if (e.key === 'ArrowLeft') { const next = Math.max(0, engine.audio.currentTime - 5); engine.audio.currentTime = next; cast.seek(next); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { const next = Math.min(dur, engine.audio.currentTime + 5); engine.audio.currentTime = next; cast.seek(next); e.preventDefault(); }
    });
  }

  // Native dialog close (Esc / backdrop)
  dlg.addEventListener('close', () => { dlg.classList.remove('is-open'); document.body.classList.remove('cast-tv-open'); stopCastVizLoop(); stopCastLyricsLoop(); });
  dlg.addEventListener('cancel', e => { e.preventDefault(); closeCastSheet(); });
  // Click backdrop ONLY when settings panel closed (avoid accidental dismiss while configuring Hue)
  dlg.addEventListener('click', e => {
    const settings = $('#castSettings');
    const settingsOpen = settings?.classList.contains('is-open');
    if (e.target === dlg && !settingsOpen) closeCastSheet();
  });

  // Settings drawer + chips
  $('#castSettingsBtn')?.addEventListener('click', () => openCastSettings());
  $('#castSettingsClose')?.addEventListener('click', () => closeCastSettings());
  $('#castVizMode')?.addEventListener('click', () => cycleCastVizMode());
  $$('.cast-seg').forEach(b => {
    b.addEventListener('click', () => {
      const m = (b as HTMLElement).dataset.viz as CastVizMode | undefined;
      if (m) setCastVizMode(m);
    });
  });

  // Fullscreen toggle
  $('#castFsBtn')?.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement) await dlg.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch { /* noop */ }
  });

  // Branded TV UI (custom receiver App ID 228565CB) — persisted opt-in.
  // Off by default so first-time users land on Default Media Receiver, which
  // is registered on every Cast device. Toggle re-applies CastContext options
  // so the next requestSession() lands on the chosen receiver.
  const modeToggle = $('#castReceiverMode') as HTMLInputElement | null;
  if (modeToggle) {
    const saved = (() => { try { return localStorage.getItem(CAST_MODE_KEY) === 'custom'; } catch { return false; } })();
    modeToggle.checked = saved;
    if (saved) cast.enableCustomReceiver();
    modeToggle.addEventListener('change', () => {
      const on = modeToggle.checked;
      try { localStorage.setItem(CAST_MODE_KEY, on ? 'custom' : 'default'); } catch { /* swallow */ }
      if (on) cast.enableCustomReceiver();
      else cast.disableCustomReceiver();
      showToast(on ? 'Branded TV UI on — pick a device registered to 228565CB' : 'Default receiver — works on any Cast device');
    });
  }

  bindCastHueControls();
}

function showToast(message: string): void {
  if (wisdomTimer !== null) { clearTimeout(wisdomTimer); wisdomTimer = null; }
  const toast = $('#wisdomToast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('is-visible');
  wisdomTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
    wisdomTimer = null;
  }, 4400);
}

const NOTIFY_LOCAL_KEY = 'bz:notify:email';
const CAST_MODE_KEY = 'bz:cast:receiver-mode';

async function refreshNotifyToggle(): Promise<void> {
  const btn = $('#notifyToggle') as HTMLButtonElement | null;
  const label = $('#notifyLabel');
  const dot = $('#notifyDot');
  if (!btn || !label) return;
  btn.hidden = false;
  const savedEmail = (() => { try { return localStorage.getItem(NOTIFY_LOCAL_KEY) || ''; } catch { return ''; } })();
  const pushOn = pushSupported() ? (await pushState()) === 'subscribed' : false;
  const subscribed = Boolean(savedEmail) || pushOn;
  btn.disabled = false;
  btn.setAttribute('aria-pressed', subscribed ? 'true' : 'false');
  btn.classList.toggle('is-active', subscribed);
  label.textContent = subscribed
    ? (pushOn ? 'On the list · push on' : 'On the list · manage')
    : 'Notify me on new drops';
  if (dot) dot.classList.toggle('is-on', subscribed);
  document.body.dataset.subscribed = subscribed ? '1' : '0';
}

function openNotifyDialog(): void {
  const dlg = $('#notifyDialog') as HTMLDialogElement | null;
  const input = $('#notifyEmail') as HTMLInputElement | null;
  const err = $('#notifyError') as HTMLParagraphElement | null;
  const pushRow = $('#notifyPushRow') as HTMLLabelElement | null;
  const pushOpt = $('#notifyPushOpt') as HTMLInputElement | null;
  const pushHint = $('#notifyPushHint') as HTMLElement | null;
  if (!dlg || !input) return;
  if (err) { err.hidden = true; err.textContent = ''; }
  try {
    const saved = localStorage.getItem(NOTIFY_LOCAL_KEY);
    if (saved) input.value = saved;
  } catch { /* ignore */ }
  if (pushRow && pushOpt && pushHint) {
    if (pushSupported()) {
      pushRow.hidden = false;
      void pushState().then(state => {
        const denied = state === 'denied';
        pushOpt.checked = state === 'subscribed';
        pushOpt.disabled = denied;
        pushHint.textContent = denied ? '· browser blocks push' : (state === 'subscribed' ? '· already on' : '');
      });
    } else {
      pushRow.hidden = true;
    }
  }
  if (typeof dlg.showModal === 'function' && !dlg.open) dlg.showModal();
  else if (!dlg.open) dlg.setAttribute('open', '');
  setTimeout(() => input.focus({ preventScroll: true }), 30);
}

function closeNotifyDialog(): void {
  const dlg = $('#notifyDialog') as HTMLDialogElement | null;
  if (dlg?.open) dlg.close();
}

async function submitNotifySubscribe(): Promise<void> {
  const input = $('#notifyEmail') as HTMLInputElement | null;
  const err = $('#notifyError') as HTMLParagraphElement | null;
  const submit = $('#notifySubmit') as HTMLButtonElement | null;
  const pushOpt = $('#notifyPushOpt') as HTMLInputElement | null;
  if (!input) return;
  const email = input.value.trim().toLowerCase();
  const showError = (msg: string) => { if (err) { err.textContent = msg; err.hidden = false; } };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    showError('Enter a valid email.');
    input.focus();
    return;
  }
  if (err) err.hidden = true;
  if (submit) { submit.disabled = true; submit.textContent = 'Subscribing…'; }
  let pushPayload: { endpoint: string; keys: { p256dh: string; auth: string } } | undefined;
  if (pushOpt?.checked && pushSupported()) {
    const res = await subscribePush();
    if (res.ok) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
          if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
            pushPayload = { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
          }
        }
      } catch { /* push payload optional */ }
    } else if (res.reason === 'denied') {
      showToast('Push blocked by browser. Email sub still works.');
    }
  }
  try {
    const resp = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, source: 'site:more-menu', pushSubscription: pushPayload })
    });
    const data = await resp.json().catch(() => ({})) as { ok?: boolean; error?: string; listmonk?: string };
    if (!resp.ok || !data.ok) {
      showError(data?.error === 'throttled' ? 'Slow down — try again in a minute.' : 'Subscribe failed. Try again in a moment.');
      if (submit) { submit.disabled = false; submit.textContent = 'Subscribe'; }
      return;
    }
    try { localStorage.setItem(NOTIFY_LOCAL_KEY, email); } catch { /* ignore */ }
    closeNotifyDialog();
    showToast(data.listmonk === 'already' ? 'Already on the list. Push synced.' : 'You’re in. New drops hit your inbox.');
    await refreshNotifyToggle();
  } catch {
    showError('Network error. Try again.');
  } finally {
    if (submit) { submit.disabled = false; submit.textContent = 'Subscribe'; }
  }
}

async function toggleNotifications(): Promise<void> {
  let savedEmail = '';
  try { savedEmail = localStorage.getItem(NOTIFY_LOCAL_KEY) || ''; } catch { /* ignore */ }
  const pushOn = pushSupported() ? (await pushState()) === 'subscribed' : false;
  if (savedEmail || pushOn) {
    if (pushOn) {
      await unsubscribePush();
      showToast('Push off. You still get email drops.');
    } else {
      try { localStorage.removeItem(NOTIFY_LOCAL_KEY); } catch { /* ignore */ }
      showToast('Local email cleared. Use the unsubscribe link in our emails to stop sends.');
    }
    await refreshNotifyToggle();
    return;
  }
  openNotifyDialog();
}

async function consumeShareTarget(): Promise<boolean> {
  if (location.pathname !== '/share-target') return false;
  const params = new URLSearchParams(location.search);
  const incoming = params.get('url') || params.get('text') || '';
  let target = incoming.trim();
  // Replace history first so refresh doesn't replay the shared URL
  history.replaceState({}, '', '/');
  if (!target) return true;
  try {
    const u = new URL(target, SITE_ORIGIN);
    if (u.origin === SITE_ORIGIN) target = u.pathname + u.search;
    const route = parseRouteFromUrl(target.split('?')[0]);
    if (route?.kind === 'track') {
      const t = TRACK_BY_ID.get(route.trackId);
      if (t) { setAlbumFilter(t.album, { push: false }); attemptDeeplinkPlay(t); return true; }
    } else if (route?.kind === 'album') {
      setAlbumFilter(route.albumId, { push: false });
      requestAnimationFrame(() => scrollToAlbum(route.albumId));
      return true;
    }
  } catch { /* not a URL — fall through */ }
  return true;
}

let appealReturnUrl: string | null = null;

function openAppeal({ pushHistory = true }: { pushHistory?: boolean } = {}) {
  const dialog = $('#appeal') as HTMLDialogElement | null;
  const frame = $('#appealFrame') as HTMLIFrameElement | null;
  if (!dialog || !frame) return;
  const expected = `${location.origin}/ashton-letter/`;
  if (frame.src !== expected) frame.src = expected;
  if (!dialog.open) dialog.showModal();
  document.documentElement.classList.add('is-appeal-open');
  if (pushHistory && location.pathname !== '/ashton/') {
    appealReturnUrl = location.pathname + location.search + location.hash;
    history.pushState({ appeal: true, returnUrl: appealReturnUrl }, '', '/ashton/');
    document.title = 'Appeal — bZ → Ashton + Mila';
  }
}

function closeAppeal({ popHistory = true }: { popHistory?: boolean } = {}) {
  const dialog = $('#appeal') as HTMLDialogElement | null;
  if (dialog?.open) dialog.close();
  document.documentElement.classList.remove('is-appeal-open');
  if (popHistory && location.pathname === '/ashton/') {
    if (appealReturnUrl) {
      history.replaceState({}, '', appealReturnUrl);
      appealReturnUrl = null;
    } else {
      history.replaceState({}, '', '/');
    }
    const t = currentTrackId ? TRACK_BY_ID.get(currentTrackId) : null;
    document.title = t
      ? `${t.title} — bZ`
      : 'bZ — live Web Audio gospel';
  }
}

/**
 * RAF-based HUD and waveform update loop. Runs every frame; drives BPM/key/peak readouts,
 * L/R VU meters, B/M/T band bars, beat-dot opacity, transport waveform canvas, and
 * beat-reactive cover art glow via direct style mutation (avoids CSS animation jank).
 */
function startHud() {
  if (hudRaf !== null) return;
  const bpmEl = $('#hudBpm');
  const peakEl = $('#hudPeak');
  const keyEl = $('#hudKey');
  const timeEl = $('#hudTime');
  const fpsEl = $('#hudFps');
  const vuLEl = $('#vuL');
  const vuREl = $('#vuR');
  const bandBass = $('#bandBass');
  const bandMid = $('#bandMid');
  const bandTreb = $('#bandTreb');
  const beatDot = $('#beatDot');
  const wave = $('#transportWave') as HTMLCanvasElement | null;
  const wctx = wave?.getContext('2d') ?? null;
  let lastFps = 60;
  let lastTextWrite = 0;
  let lastMeterWrite = 0;
  let lastBeatVar = -1;
  let lastWaveFrame = 0;
  let waveW = 0, waveH = 0, waveDpr = 1;
  let lastBpm = -1, lastPeak = -1, lastKey = '', lastCur = '', lastTot = '', lastFpsTxt = -1;
  let lastVuL = -1, lastVuR = -1, lastBass = -1, lastMid = -1, lastTreb = -1, lastBeatDot = -1;
  let lastBeatGlowKey = '';
  const TEXT_INTERVAL_MS = 250;
  const METER_INTERVAL_MS = 33;
  const WAVE_INTERVAL_MS = 33;

  const refreshWaveDims = () => {
    if (!wave) return;
    waveDpr = Math.min(2, window.devicePixelRatio || 1);
    waveW = wave.clientWidth;
    waveH = wave.clientHeight;
    wave.width = Math.max(1, waveW * waveDpr);
    wave.height = Math.max(1, waveH * waveDpr);
  };
  if (wave) {
    refreshWaveDims();
    const ro = new ResizeObserver(() => refreshWaveDims());
    ro.observe(wave);
  }
  let waveAccent = (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00e5ff');

  const drawWave = () => {
    if (!wave || !wctx || !engine.timeData?.length || waveW < 2) return;
    wctx.setTransform(waveDpr, 0, 0, waveDpr, 0, 0);
    wctx.clearRect(0, 0, waveW, waveH);
    const td = engine.timeData;
    const len = td.length;
    const step = Math.max(1, Math.floor(len / waveW));
    wctx.strokeStyle = waveAccent;
    wctx.lineWidth = 1.4;
    wctx.globalAlpha = 0.55;
    wctx.beginPath();
    const halfH = waveH / 2;
    for (let x = 0; x < waveW; x++) {
      const i = Math.min(len - 1, x * step);
      const v = (td[i] - 128) / 128;
      const y = halfH + v * (halfH - 1);
      if (x === 0) wctx.moveTo(x, y);
      else wctx.lineTo(x, y);
    }
    wctx.stroke();
    wctx.globalAlpha = 1;
  };

  const writePct = (el: HTMLElement | null, val: number, last: number, scale: number, store: (v: number) => void) => {
    if (!el) return;
    const pct = Math.min(100, val * scale);
    const q = Math.round(pct * 2);
    if (q === last) return;
    store(q);
    el.style.width = `${pct.toFixed(1)}%`;
  };
  const writeBand = (el: HTMLElement | null, val: number, last: number, scale: number, store: (v: number) => void) => {
    if (!el) return;
    const pct = Math.min(100, val * scale);
    const q = Math.round(pct * 2);
    if (q === last) return;
    store(q);
    el.style.height = `${pct.toFixed(1)}%`;
  };

  const tick = (now: DOMHighResTimeStamp) => {
    if (document.hidden) {
      hudRaf = requestAnimationFrame(tick);
      return;
    }
    const m = visualizer.audioMeters();
    const textDue = now - lastTextWrite >= TEXT_INTERVAL_MS;
    if (textDue) {
      lastTextWrite = now;
      const bpmVal = m.bpm > 30 ? Math.round(m.bpm) : -1;
      if (bpmEl && bpmVal !== lastBpm) {
        bpmEl.textContent = bpmVal === -1 ? '—' : bpmVal.toString();
        lastBpm = bpmVal;
      }
      const peakVal = Math.round(m.peakHz);
      if (peakEl && peakVal !== lastPeak) {
        peakEl.textContent = fmtHz(m.peakHz);
        lastPeak = peakVal;
      }
      const noteVal = hzToNote(m.peakHz);
      if (keyEl && noteVal !== lastKey) {
        keyEl.textContent = noteVal;
        lastKey = noteVal;
      }
      if (timeEl) {
        const a = engine.audio;
        const cur = fmtClock(a.currentTime || 0);
        const tot = a.duration && Number.isFinite(a.duration) ? fmtClock(a.duration) : '—:—';
        if (cur !== lastCur || tot !== lastTot) {
          timeEl.textContent = `${cur} / ${tot}`;
          lastCur = cur;
          lastTot = tot;
        }
      }
      const fps = visualizer.fps();
      lastFps = lastFps * 0.7 + fps * 0.3;
      const fpsVal = Math.round(lastFps);
      if (fpsEl && fpsVal !== lastFpsTxt) {
        fpsEl.textContent = fpsVal.toString();
        lastFpsTxt = fpsVal;
      }
    }

    const meterDue = now - lastMeterWrite >= METER_INTERVAL_MS;
    if (meterDue) {
      lastMeterWrite = now;
      writePct(vuLEl, m.ch.l, lastVuL, 140, v => { lastVuL = v; });
      writePct(vuREl, m.ch.r, lastVuR, 140, v => { lastVuR = v; });
      writeBand(bandBass, m.bass, lastBass, 130, v => { lastBass = v; });
      writeBand(bandMid, m.mid, lastMid, 130, v => { lastMid = v; });
      writeBand(bandTreb, m.treble, lastTreb, 130, v => { lastTreb = v; });
      if (beatDot) {
        const op = Math.round((0.15 + m.beat * 0.85) * 100);
        if (op !== lastBeatDot) {
          lastBeatDot = op;
          beatDot.style.opacity = (op / 100).toString();
        }
      }
    }

    const npCover = $('#transportNpCover') as HTMLImageElement | null;
    if (npCover) {
      if (m.beat > 0.05) {
        const g = Math.round(10 + m.beat * 44);
        const g2 = Math.round(g * 0.55);
        const a1 = Math.round(30 + m.beat * 65);
        const a2 = Math.round(18 + m.beat * 48);
        const key = `${g}|${a1}|${a2}`;
        if (key !== lastBeatGlowKey) {
          npCover.style.boxShadow = `0 0 ${g}px ${Math.round(g * 0.45)}px color-mix(in srgb, var(--accent) ${a1}%, transparent), 0 0 ${g2}px ${Math.round(g2 * 0.3)}px color-mix(in srgb, var(--violet) ${a2}%, transparent)`;
          lastBeatGlowKey = key;
        }
      } else if (lastBeatGlowKey !== '') {
        npCover.style.boxShadow = '';
        lastBeatGlowKey = '';
      }
    }

    const beatQ = Math.round(m.beat * 50);
    if (beatQ !== lastBeatVar) {
      lastBeatVar = beatQ;
      document.documentElement.style.setProperty('--topbar-beat', (beatQ / 50).toFixed(2));
    }

    if (now - lastWaveFrame >= WAVE_INTERVAL_MS) {
      lastWaveFrame = now;
      drawWave();
    }
    hudRaf = requestAnimationFrame(tick);
  };
  hudRaf = requestAnimationFrame(tick);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      lastBpm = -1; lastPeak = -1; lastKey = ''; lastCur = ''; lastTot = ''; lastFpsTxt = -1;
      lastVuL = -1; lastVuR = -1; lastBass = -1; lastMid = -1; lastTreb = -1; lastBeatDot = -1;
      lastBeatVar = -1; lastBeatGlowKey = '';
      lastTextWrite = 0; lastMeterWrite = 0; lastWaveFrame = 0;
      waveAccent = (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00e5ff');
    }
  });
}

function bindUi() {
  const bg = $('#bg') as HTMLCanvasElement;
  visualizer = new Visualizer(bg, engine);
  visualizer.setAccent(ALBUMS[0].accent);
  visualizer.start();
  visualizer.setAutoCycle(true);

  const modeBtnLabel = $('#modeBtnLabel');
  const vizGrid = $('#vizGrid') as HTMLDivElement | null;
  const vizSearch = $('#vizSearch') as HTMLInputElement | null;
  const vizAutoCycle = $('#vizAutoCycle') as HTMLInputElement | null;
  const vizPickerTitle = $('#vizPickerTitle');
  buildVizPicker(vizGrid, visualizer.modeCatalog(), visualizer.currentMode());
  if (vizPickerTitle) vizPickerTitle.textContent = `${visualizer.modeCatalog().length} modes`;
  visualizer.onModeChange((m: VizMode) => {
    if (modeBtnLabel) modeBtnLabel.textContent = m;
    markActiveVizChip(vizGrid, m);
    if (vizAutoCycle) vizAutoCycle.checked = false;
    const u = new URL(window.location.href);
    u.searchParams.set('viz', m);
    window.history.replaceState({}, '', u.toString());
  });
  if (modeBtnLabel) modeBtnLabel.textContent = visualizer.currentMode();
  markActiveVizChip(vizGrid, visualizer.currentMode());
  vizGrid?.addEventListener('click', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-viz-slug]');
    if (!chip) return;
    const slug = chip.dataset.vizSlug as VizMode;
    visualizer.setMode(slug);
    const dlg = $('#vizPicker') as HTMLElement & { hidePopover?: () => void } | null;
    try { dlg?.hidePopover?.(); } catch { /* not supported / not open */ }
  });
  vizSearch?.addEventListener('input', () => filterVizGrid(vizGrid, vizSearch.value));
  vizAutoCycle?.addEventListener('change', () => {
    const on = vizAutoCycle.checked;
    visualizer.setAutoCycle(on);
  });
  const dlg = $('#vizPicker') as HTMLElement | null;
  dlg?.addEventListener('toggle', (e) => {
    const open = (e as ToggleEvent).newState === 'open';
    const btn = $('#modeBtn');
    btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && vizSearch) {
      vizSearch.value = '';
      filterVizGrid(vizGrid, '');
      requestAnimationFrame(() => vizSearch.focus());
    }
    if (!open) {
      // Restore focus to the opener button so keyboard nav stays on track.
      (btn as HTMLButtonElement | null)?.focus({ preventScroll: true });
    }
  });

  // Keyboard navigation inside the popover: arrow keys cycle chips,
  // Home/End jump to ends, Enter activates focused chip, "/" focuses search,
  // Esc closes (popover=auto already handles this — kept explicit for safety).
  dlg?.addEventListener('keydown', (e: KeyboardEvent) => {
    const k = e.key;
    if (k === 'Escape') {
      (dlg as HTMLElement & { hidePopover?: () => void }).hidePopover?.();
      e.preventDefault();
      return;
    }
    if (k === '/' && document.activeElement !== vizSearch) {
      vizSearch?.focus();
      e.preventDefault();
      return;
    }
    const chips = Array.from(vizGrid?.querySelectorAll<HTMLButtonElement>('.viz-chip:not([hidden])') ?? []);
    if (!chips.length) return;
    const active = document.activeElement as HTMLElement | null;
    const inGrid = active && vizGrid?.contains(active);
    // Down/Right from search → first chip.
    if (active === vizSearch && (k === 'ArrowDown' || k === 'ArrowRight')) {
      chips[0]?.focus();
      e.preventDefault();
      return;
    }
    if (!inGrid) return;
    const i = chips.indexOf(active as HTMLButtonElement);
    if (i < 0) return;
    let next = i;
    if (k === 'ArrowRight') next = (i + 1) % chips.length;
    else if (k === 'ArrowLeft') next = (i - 1 + chips.length) % chips.length;
    else if (k === 'ArrowDown') {
      // Estimate row width by clientWidth / chip width.
      const w = chips[0].getBoundingClientRect().width || 1;
      const rowSize = Math.max(1, Math.floor((vizGrid?.clientWidth ?? w) / w));
      next = Math.min(chips.length - 1, i + rowSize);
    }
    else if (k === 'ArrowUp') {
      const w = chips[0].getBoundingClientRect().width || 1;
      const rowSize = Math.max(1, Math.floor((vizGrid?.clientWidth ?? w) / w));
      next = Math.max(0, i - rowSize);
      if (next === i) { vizSearch?.focus(); e.preventDefault(); return; }
    }
    else if (k === 'Home') next = 0;
    else if (k === 'End') next = chips.length - 1;
    else if (k === 'Enter' || k === ' ') {
      chips[i].click();
      e.preventDefault();
      return;
    }
    else return;
    chips[next]?.focus();
    e.preventDefault();
  });

  // Search → ArrowDown / Enter jumps to first visible chip.
  vizSearch?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      const first = vizGrid?.querySelector<HTMLButtonElement>('.viz-chip:not([hidden])');
      if (first) {
        first.focus();
        e.preventDefault();
      }
    }
  });

  const vizParam = new URLSearchParams(window.location.search).get('viz');
  if (vizParam) {
    try { visualizer.setMode(vizParam as VizMode); } catch { /* unknown slug */ }
  }

  bindMediaSession();

  $('#albums')?.addEventListener('click', e => {
    const me = e as MouseEvent;
    if (me.metaKey || me.ctrlKey || me.shiftKey) return;
    const target = e.target as HTMLElement;
    const shareTrackBtn = target.closest('[data-share-track]') as HTMLButtonElement | null;
    if (shareTrackBtn) {
      e.preventDefault();
      e.stopPropagation();
      openShare('track', shareTrackBtn.dataset.shareTrack!);
      return;
    }
    const subscribeBtn = target.closest('.album__subscribe[data-action="notify"]') as HTMLButtonElement | null;
    if (subscribeBtn) {
      e.preventDefault();
      e.stopPropagation();
      void toggleNotifications();
      return;
    }
    const shareAlbumBtn = target.closest('[data-share-album]') as HTMLButtonElement | null;
    if (shareAlbumBtn) {
      e.preventDefault();
      e.stopPropagation();
      openShare('album', shareAlbumBtn.dataset.shareAlbum!);
      return;
    }
    const back = target.closest('[data-albums-back]') as HTMLAnchorElement | null;
    if (back) {
      e.preventDefault();
      setAlbumFilter(null, { push: true });
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const albumLink = target.closest('[data-album-link]') as HTMLAnchorElement | null;
    if (albumLink) {
      e.preventDefault();
      const albumId = albumLink.dataset.albumLink!;
      setAlbumFilter(albumId, { push: true });
      requestAnimationFrame(() => scrollToAlbum(albumId));
      return;
    }
    const row = target.closest('[data-track]') as HTMLAnchorElement | null;
    if (!row) return;
    e.preventDefault();
    const wrap = row.closest('.trackrow-wrap') as HTMLElement | null;
    if (wrap) spawnRipple(wrap, me);
    const t = TRACK_BY_ID.get(row.dataset.track!);
    if (t) play(t);
  });

  $('#btnShare')?.addEventListener('click', () => {
    if (currentTrackId) openShare('track', currentTrackId);
    else if (TRACKS[0]) openShare('album', TRACKS[0].album);
  });

  $('#shareClose')?.addEventListener('click', () => closeShare());
  $('#share')?.addEventListener('click', e => {
    if ((e.target as HTMLElement).id === 'share') closeShare();
  });
  $('#share')?.addEventListener('cancel', e => { e.preventDefault(); closeShare(); });

  $('#shareCopyLink')?.addEventListener('click', e => {
    if (!shareCurrent) return;
    copyText(shareCurrent.shareUrl, e.currentTarget as HTMLElement);
  });
  $('#shareCopyEmbed')?.addEventListener('click', e => {
    if (!shareCurrent) return;
    copyText(embedSnippet(shareCurrent, shareEmbedSize), e.currentTarget as HTMLElement);
  });
  $('#shareNative')?.addEventListener('click', async () => {
    if (!shareCurrent) return;
    await shareWithFallback(
      { title: `${shareCurrent.title} — bZ`, text: `${shareCurrent.title} — bZ`, url: shareCurrent.shareUrl },
      () => { /* dialog already open */ }
    );
  });
  document.querySelectorAll<HTMLButtonElement>('.share__size').forEach(btn => {
    btn.addEventListener('click', () => {
      shareEmbedSize = (btn.dataset.size as EmbedSize) || 'small';
      document.querySelectorAll<HTMLButtonElement>('.share__size').forEach(b => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-checked', active ? 'true' : 'false');
      });
      const code = $('#shareEmbedCode') as HTMLTextAreaElement | null;
      if (code && shareCurrent) code.value = embedSnippet(shareCurrent, shareEmbedSize);
    });
  });

  $('#apPlay')?.addEventListener('click', () => {
    const t = autoplayPromptTrack;
    dismissAutoplayPrompt();
    if (t) play(t);
  });
  $('#apClose')?.addEventListener('click', () => dismissAutoplayPrompt());
  $('#autoplayPrompt')?.addEventListener('click', e => {
    if ((e.target as HTMLElement).id === 'autoplayPrompt') dismissAutoplayPrompt();
  });
  $('#autoplayPrompt')?.addEventListener('cancel', e => {
    e.preventDefault();
    dismissAutoplayPrompt();
  });

  $('#btnShuffle')?.addEventListener('click', () => {
    shuffleOn = !shuffleOn;
    persist(LS_KEYS.shuffle, shuffleOn ? '1' : '0');
    refreshShuffleBtn();
  });
  $('#btnPrev')?.addEventListener('click', () => nextTrack(-1));
  $('#btnNext')?.addEventListener('click', () => nextTrack(1));
  $('#btnPlay')?.addEventListener('click', () => {
    if (!currentTrackId) {
      play(TRACKS[0]);
      return;
    }
    if (cast.active) cast.togglePlayPause();
    else engine.toggle();
  });
  $('#btnLoop')?.addEventListener('click', () => cycleLoop());
  $('#lyricsFsClose')?.addEventListener('click', () => closeLyricsFs());

  const moreBtn = $('#btnMore');
  const moreMenu = $('#moreMenu');
  const closeMoreMenu = () => {
    if (!moreMenu) return;
    moreMenu.hidden = true;
    moreBtn?.setAttribute('aria-expanded', 'false');
  };
  const openMoreMenu = () => {
    if (!moreMenu || !moreBtn) return;
    const r = moreBtn.getBoundingClientRect();
    moreMenu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    moreMenu.style.bottom = `${window.innerHeight - r.top + 10}px`;
    moreMenu.hidden = false;
    moreBtn.setAttribute('aria-expanded', 'true');
    mountSpotifyConnect(moreMenu);
  };
  moreBtn?.addEventListener('click', e => {
    e.stopPropagation();
    if (moreMenu?.hidden) openMoreMenu(); else closeMoreMenu();
  });
  moreMenu?.addEventListener('click', e => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-sleep]');
    if (!item) return;
    if (item.dataset.sleep !== undefined) {
      const v = item.dataset.sleep;
      if (v === 'track') setSleepTimer('track');
      else setSleepTimer(Number(v) || 0);
      return;
    }
    const action = item.dataset.action;
    if (action === 'share' && currentTrackId) openShare('track', currentTrackId);
    else if (action === 'fs-lyrics') { if (lyricsFsOpen) closeLyricsFs(); else openLyricsFs(); }
    else if (action === 'queue') { if (queuePanelOpen) closeQueuePanel(); else openQueuePanel(); }
    else if (action === 'shortcuts') openShortcuts();
    else if (action === 'smart-link') {
      const t = currentTrackId ? TRACK_BY_ID.get(currentTrackId) : null;
      if (t) {
        const album = ALBUM_BY_ID.get(t.album);
        if (album) openSmartLink(`${SITE_ORIGIN}${trackPath(t)}`);
      }
    }
    else if (action === 'notify') { void toggleNotifications(); return; }
    if (action !== 'spotify') closeMoreMenu();
  });
  document.addEventListener('click', e => {
    if (!moreMenu || moreMenu.hidden) return;
    if (!(e.target as HTMLElement).closest('#moreMenu, #btnMore')) closeMoreMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && moreMenu && !moreMenu.hidden) {
      closeMoreMenu();
      moreBtn?.focus();
    }
  });

  $('#queueClose')?.addEventListener('click', () => closeQueuePanel());
  document.querySelectorAll<HTMLButtonElement>('.queue-panel__tab').forEach(b => {
    b.addEventListener('click', () => {
      renderQueueTab(b.dataset.tab ?? 'up-next');
      bumpQueueIdle();
    });
  });
  $('#queuePanel')?.addEventListener('pointerdown', bumpQueueIdle);
  $('#queueBody')?.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const filterChip = target.closest<HTMLButtonElement>('[data-q-filter]');
    if (filterChip) {
      const kind = filterChip.dataset.qFilter ?? '';
      const value = filterChip.dataset.qValue ?? '';
      renderQueueTab(currentQueueTab, { kind, value });
      bumpQueueIdle();
      return;
    }
    const row = target.closest<HTMLButtonElement>('[data-q-track]');
    if (!row) return;
    const t = TRACK_BY_ID.get(row.dataset.qTrack!);
    if (t) {
      play(t);
      bumpQueueIdle();
      const body = $('#queueBody');
      body?.querySelectorAll<HTMLElement>('[data-q-track].is-current').forEach(el => el.classList.remove('is-current'));
      row.classList.add('is-current');
    }
  });

  $('#shortcutsCloseBtn')?.addEventListener('click', () => closeShortcuts());
  $('#shortcuts')?.addEventListener('click', e => {
    if ((e.target as HTMLElement).id === 'shortcuts') closeShortcuts();
  });
  $('#shortcuts')?.addEventListener('cancel', e => { e.preventDefault(); closeShortcuts(); });

  $('#notifyCloseBtn')?.addEventListener('click', () => closeNotifyDialog());
  $('#notifyDialog')?.addEventListener('click', e => {
    if ((e.target as HTMLElement).id === 'notifyDialog') closeNotifyDialog();
  });
  $('#notifyDialog')?.addEventListener('cancel', e => { e.preventDefault(); closeNotifyDialog(); });
  $('#notifyForm')?.addEventListener('submit', e => { e.preventDefault(); void submitNotifySubscribe(); });
  ($('#vol') as HTMLInputElement)?.addEventListener('input', e => {
    const v = Number((e.target as HTMLInputElement).value);
    engine.setVolume(v);
    if (cast.active) cast.setVolume(v);
  });

  const bar = $('#bar');
  if (bar) {
    let scrubbing = false;
    let scrubPointer = -1;
    const ratioFor = (clientX: number) => {
      const r = bar.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    };
    const updateHoverChrome = (ratio: number) => {
      bar.style.setProperty('--bar-hover', `${ratio * 100}%`);
      const hoverTimeEl = $('#transportHoverTime');
      if (hoverTimeEl) {
        const dur = engine.audio.duration;
        hoverTimeEl.textContent = Number.isFinite(dur) ? fmtTime(dur * ratio) : '0:00';
        hoverTimeEl.style.left = `${ratio * 100}%`;
      }
    };
    bar.addEventListener('pointerdown', (e: PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      scrubbing = true;
      scrubPointer = e.pointerId;
      try { bar.setPointerCapture(e.pointerId); } catch {}
      const ratio = ratioFor(e.clientX);
      engine.seekRatio(ratio);
      updateHoverChrome(ratio);
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e: PointerEvent) => {
      const ratio = ratioFor(e.clientX);
      updateHoverChrome(ratio);
      if (!scrubbing || e.pointerId !== scrubPointer) return;
      engine.seekRatio(ratio);
    });
    const endScrub = (e: PointerEvent) => {
      if (!scrubbing || e.pointerId !== scrubPointer) return;
      scrubbing = false;
      try { bar.releasePointerCapture(e.pointerId); } catch {}
      scrubPointer = -1;
      if (cast.active) {
        const dur = engine.audio.duration;
        const ratio = ratioFor(e.clientX);
        const seconds = Number.isFinite(dur) ? dur * ratio : 0;
        cast.seek(seconds);
      }
    };
    bar.addEventListener('pointerup', endScrub);
    bar.addEventListener('pointercancel', endScrub);
    bar.addEventListener('keydown', (e: KeyboardEvent) => {
      const dur = engine.audio.duration;
      if (!Number.isFinite(dur) || !dur) return;
      const cur = engine.audio.currentTime;
      let next = cur;
      if (e.key === 'ArrowRight') { next = Math.min(dur, cur + 5); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { next = Math.max(0, cur - 5); e.preventDefault(); }
      else if (e.key === 'Home') { next = 0; e.preventDefault(); }
      else if (e.key === 'End') { next = dur; e.preventDefault(); }
      else return;
      engine.audio.currentTime = next;
      if (cast.active) cast.seek(next);
    });
  }

  let prevVolume = 0.85;
  $('#btnVol')?.addEventListener('click', () => {
    const volInput = $('#vol') as HTMLInputElement | null;
    if (!volInput) return;
    const cur = Number(volInput.value);
    if (cur > 0) {
      prevVolume = cur;
      volInput.value = '0';
      engine.setVolume(0);
    } else {
      volInput.value = String(prevVolume);
      engine.setVolume(prevVolume);
    }
    refreshVolIcon();
  });
  $('#vol')?.addEventListener('input', () => refreshVolIcon());

  $('#lnkAppeal')?.addEventListener('click', e => {
    if ((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey || (e as MouseEvent).shiftKey) return;
    e.preventDefault();
    openAppeal();
  });
  $('#appealClose')?.addEventListener('click', () => closeAppeal());
  $('#appeal')?.addEventListener('click', e => {
    if ((e.target as HTMLElement).id === 'appeal') closeAppeal();
  });
  $('#appeal')?.addEventListener('cancel', e => {
    e.preventDefault();
    closeAppeal();
  });
  window.addEventListener('message', e => {
    if (e.origin !== location.origin) return;
    if ((e.data as { type?: string } | null)?.type === 'panda-appeal-close') closeAppeal();
  });

  // Live lyrics overlay
  $('#btnLyricsOverlay')?.addEventListener('click', () => setKaraokeOverlay(!karaokeOverlayOn));
  $('#karaokeClose')?.addEventListener('click', () => setKaraokeOverlay(false));
  setKaraokeOverlay(karaokeOverlayOn);

  // Search overlay
  $('#btnSearch')?.addEventListener('click', () => openSearch());
  $('#cmdk')?.addEventListener('click', e => {
    if ((e.target as HTMLElement).id === 'cmdk') closeSearch();
  });
  $('#cmdkInput')?.addEventListener('input', e => {
    const q = (e.target as HTMLInputElement).value;
    searchActiveIdx = 0;
    renderSearchResults(filterTracks(q));
  });
  $('#cmdkInput')?.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); searchMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); searchMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); searchCommit(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
  });
  $('#cmdkResults')?.addEventListener('click', e => {
    const item = (e.target as HTMLElement).closest('.cmdk__item') as HTMLElement | null;
    if (!item) return;
    const idx = Number(item.dataset.idx ?? -1);
    const input = $('#cmdkInput') as HTMLInputElement | null;
    const tracks = filterTracks(input?.value ?? '');
    const t = tracks[idx];
    if (t) { closeSearch(); play(t); }
  });

  // Now-playing panel
  $('#transportNpCover')?.addEventListener('click', () => openNpPanel());
  $('#npPanelClose')?.addEventListener('click', () => closeNpPanel());
  $('#npPanelBackdrop')?.addEventListener('click', () => closeNpPanel());
  $('#eqBass')?.addEventListener('input', e => {
    const v = Number((e.target as HTMLInputElement).value);
    engine.setEQ({ bass: v });
    const el = $('#eqBassVal');
    if (el) el.textContent = `${v >= 0 ? '+' : ''}${v} dB`;
  });
  $('#eqMid')?.addEventListener('input', e => {
    const v = Number((e.target as HTMLInputElement).value);
    engine.setEQ({ mid: v });
    const el = $('#eqMidVal');
    if (el) el.textContent = `${v >= 0 ? '+' : ''}${v} dB`;
  });
  $('#eqTreb')?.addEventListener('input', e => {
    const v = Number((e.target as HTMLInputElement).value);
    engine.setEQ({ treble: v });
    const el = $('#eqTrebVal');
    if (el) el.textContent = `${v >= 0 ? '+' : ''}${v} dB`;
  });
  document.querySelectorAll<HTMLButtonElement>('.np-panel__reverb-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset as ReverbPreset | undefined;
      if (!preset) return;
      activeReverb = preset;
      engine.setReverbPreset(preset);
      document.querySelectorAll<HTMLButtonElement>('.np-panel__reverb-btn').forEach(b => {
        b.classList.toggle('is-active', b === btn);
      });
    });
  });

  document.addEventListener('keydown', e => {
    const inField = e.target && (e.target as HTMLElement).matches('input, textarea, select');
    // Cmd+K / Ctrl+K: open search regardless of focus
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyK') { e.preventDefault(); openSearch(); return; }
    if (e.key === 'Escape') {
      if (searchOpen) { closeSearch(); return; }
      if (lyricsFsOpen) { closeLyricsFs(); return; }
      if (queuePanelOpen) { closeQueuePanel(); return; }
      if (shortcutsOpen) { closeShortcuts(); return; }
      if (npPanelOpen) { closeNpPanel(); return; }
    }
    if (inField) return;
    if (e.code === 'Space') { e.preventDefault(); $('#btnPlay')?.click(); }
    else if (e.code === 'ArrowRight' && !e.shiftKey) nextTrack(1);
    else if (e.code === 'ArrowLeft' && !e.shiftKey) nextTrack(-1);
    else if (e.code === 'ArrowUp') {
      e.preventDefault();
      const v = $('#vol') as HTMLInputElement | null;
      if (v) { v.value = String(Math.min(1, Number(v.value) + 0.05)); engine.setVolume(Number(v.value)); refreshVolIcon(); }
    }
    else if (e.code === 'ArrowDown') {
      e.preventDefault();
      const v = $('#vol') as HTMLInputElement | null;
      if (v) { v.value = String(Math.max(0, Number(v.value) - 0.05)); engine.setVolume(Number(v.value)); refreshVolIcon(); }
    }
    else if (e.code === 'BracketLeft') {
      engine.audio.currentTime = Math.max(0, engine.audio.currentTime - 10);
    }
    else if (e.code === 'BracketRight') {
      engine.audio.currentTime = Math.min(engine.audio.duration || 0, engine.audio.currentTime + 10);
    }
    else if (e.code.startsWith('Digit') && Number.isFinite(engine.audio.duration)) {
      const n = Number(e.code.slice(5));
      if (!Number.isNaN(n)) engine.seekRatio(n / 10);
    }
    else if (e.code === 'KeyV') {
      if (e.shiftKey) visualizer.cycleModeReverse(); else visualizer.cycleMode();
    }
    else if (e.code === 'KeyL' && e.shiftKey) { setKaraokeOverlay(!karaokeOverlayOn); }
    else if (e.code === 'KeyL' || e.code === 'KeyF') { if (lyricsFsOpen) closeLyricsFs(); else openLyricsFs(); }
    else if (e.code === 'KeyM') $('#btnVol')?.click();
    else if (e.code === 'KeyH') { if (currentTrackId) openShare('track', currentTrackId); }
    else if (e.code === 'KeyQ') { if (queuePanelOpen) closeQueuePanel(); else openQueuePanel(); }
    else if (e.code === 'KeyN') {
      if (npPanelOpen) closeNpPanel(); else openNpPanel();
    }
    else if (e.code === 'KeyR') cycleLoop();
    else if (e.code === 'KeyS') {
      shuffleOn = !shuffleOn;
      persist(LS_KEYS.shuffle, shuffleOn ? '1' : '0');
      refreshShuffleBtn();
    }
    else if (e.key === '?' || (e.shiftKey && e.code === 'Slash')) {
      e.preventDefault();
      if (shortcutsOpen) closeShortcuts(); else openShortcuts();
    }
  });

  engine.on(() => {
    const s = engine.state();
    const playIcon = $('#playIcon') as SVGElement | null;
    if (playIcon) {
      playIcon.innerHTML = s.playing
        ? '<rect x="6" y="4" width="4" height="16" rx="1.5"/><rect x="14" y="4" width="4" height="16" rx="1.5"/>'
        : '<polygon points="6 3 20 12 6 21 6 3"/>';
    }
    const now = $('#transportNow');
    const total = $('#transportTotal');
    if (now) now.textContent = fmtTime(s.currentTime);
    if (total) total.textContent = fmtTime(s.duration);
    const fill = $('#transportFill') as HTMLElement | null;
    const thumb = $('#transportThumb') as HTMLElement | null;
    const buf = $('#transportBuffer') as HTMLElement | null;
    const bgFill = $('#transportBgFill') as HTMLElement | null;
    const ratio = s.duration ? s.currentTime / s.duration : 0;
    const pct = `${(ratio * 100).toFixed(2)}%`;
    const bar = $('#bar');
    if (fill) fill.style.width = pct;
    if (thumb) thumb.style.left = pct;
    if (bgFill) bgFill.style.width = pct;
    if (bar) bar.setAttribute('aria-valuenow', ratio.toFixed(3));
    if (buf && engine.audio.buffered.length) {
      const end = engine.audio.buffered.end(engine.audio.buffered.length - 1);
      buf.style.width = `${s.duration ? (end / s.duration) * 100 : 0}%`;
    }
    if (s.playing) document.documentElement.classList.add('is-playing');
    else document.documentElement.classList.remove('is-playing');
    const ring = $('#transportPlayRing');
    if (ring) ring.style.background = `conic-gradient(var(--accent) ${(ratio * 360).toFixed(2)}deg, transparent 0)`;
    if (engine.audio.ended) handleEnded();
  });
  refreshVolIcon();

  window.addEventListener('popstate', () => {
    const path = location.pathname;
    const appealOpen = ($('#appeal') as HTMLDialogElement | null)?.open ?? false;
    if (path === '/ashton/' && !appealOpen) {
      openAppeal({ pushHistory: false });
      return;
    }
    if (path !== '/ashton/' && appealOpen) {
      closeAppeal({ popHistory: false });
    }
    const route = parseRouteFromUrl(path);
    if (route?.kind === 'track') {
      const t = TRACK_BY_ID.get(route.trackId);
      if (!t) return;
      if (currentAlbumFilter !== t.album) setAlbumFilter(t.album, { push: false });
      if (route.trackId !== currentTrackId) play(t);
    } else if (route?.kind === 'album') {
      if (currentAlbumFilter !== route.albumId) setAlbumFilter(route.albumId, { push: false });
      requestAnimationFrame(() => scrollToAlbum(route.albumId));
    } else if (path === '/' || path === '') {
      if (currentAlbumFilter !== null) setAlbumFilter(null, { push: false });
    }
  });

  startHud();
  startKaraoke();

  (window as unknown as { __panda: unknown }).__panda = {
    engine,
    visualizer,
    tracks: TRACKS,
    nowPlaying: () => (currentTrackId ? TRACK_BY_ID.get(currentTrackId) : null),
    play,
    cast,
    castDebug: () => ({
      loaded: cast.loaded,
      available: cast.available,
      active: cast.active,
      launcherDefined: !!customElements.get('google-cast-launcher'),
      launcherPointerEvents: ($('#castLauncher') as HTMLElement | null)?.style.pointerEvents ?? null,
      audioDisableRemotePlayback: engine.audio.disableRemotePlayback,
      ctxState: (() => {
        try { return window.cast?.framework?.CastContext?.getInstance?.()?.getCastState?.() ?? null; }
        catch { return null; }
      })(),
      userActivation: { isActive: navigator.userActivation?.isActive ?? null, hasBeenActive: navigator.userActivation?.hasBeenActive ?? null }
    })
  };
}

function handleEnded() {
  if (loopMode === 'one' && currentTrackId) {
    const t = TRACK_BY_ID.get(currentTrackId);
    if (t) { engine.audio.currentTime = 0; engine.play(t); return; }
  }
  // 'all' loops the full track list at end (default behavior); 'off' still advances
  // but if at the last track and not 'all', stops.
  if (loopMode === 'off') {
    const idx = TRACKS.findIndex(t => t.id === currentTrackId);
    if (idx === TRACKS.length - 1) { engine.audio.pause(); return; }
  }
  nextTrack(1);
}

function nextTrack(dir: 1 | -1) {
  if (shuffleOn && dir === 1) {
    const others = TRACKS.filter(t => t.id !== currentTrackId);
    const next = others[Math.floor(Math.random() * others.length)];
    if (next) play(next);
    return;
  }
  const idx = TRACKS.findIndex(t => t.id === currentTrackId);
  const next = TRACKS[(idx + dir + TRACKS.length) % TRACKS.length];
  if (next) play(next);
}

function setLoopMode(m: LoopMode) {
  loopMode = m;
  persist(LS_KEYS.loop, m);
  refreshLoopBtn();
}

function cycleLoop() {
  const order: LoopMode[] = ['off', 'all', 'one'];
  const next = order[(order.indexOf(loopMode) + 1) % order.length];
  setLoopMode(next);
}

function refreshLoopBtn() {
  const btn = $('#btnLoop');
  const badge = $('#loopBadge');
  if (!btn) return;
  btn.classList.toggle('is-on', loopMode !== 'off');
  btn.classList.toggle('is-loop-one', loopMode === 'one');
  btn.setAttribute('aria-label', loopMode === 'off' ? 'Loop: off' : loopMode === 'all' ? 'Loop: all' : 'Loop: one');
  if (badge) badge.hidden = loopMode !== 'one';
}

function refreshShuffleBtn() {
  $('#btnShuffle')?.classList.toggle('is-on', shuffleOn);
}

function setActiveSleepChip(value: string | null) {
  document.querySelectorAll<HTMLButtonElement>('.more-menu__chip').forEach(c => {
    c.classList.toggle('is-on', value !== null && c.dataset.sleep === value);
  });
}

function setSleepTimer(mins: number | 'track') {
  if (sleepTimerHandle) { clearTimeout(sleepTimerHandle); sleepTimerHandle = null; }
  if (sleepTickHandle) { clearInterval(sleepTickHandle); sleepTickHandle = null; }
  sleepTimerEndAt = 0;
  const label = $('#sleepLabel');
  const moreBtn = $('#btnMore');
  moreBtn?.classList.remove('has-sleep');
  if (label) label.textContent = 'off';
  if (mins === 0) { setActiveSleepChip('0'); return; }
  if (mins === 'track') {
    const onEnd = () => {
      engine.audio.removeEventListener('ended', onEnd);
      fadeOutAndPause();
      moreBtn?.classList.remove('has-sleep');
      if (label) label.textContent = 'off';
      setActiveSleepChip('0');
    };
    engine.audio.addEventListener('ended', onEnd, { once: true });
    moreBtn?.classList.add('has-sleep');
    if (label) label.textContent = 'end of track';
    setActiveSleepChip('track');
    return;
  }
  sleepTimerEndAt = Date.now() + mins * 60_000;
  sleepTimerHandle = setTimeout(() => fadeOutAndPause(), mins * 60_000);
  moreBtn?.classList.add('has-sleep');
  setActiveSleepChip(String(mins));
  const tickLabel = () => {
    if (!sleepTimerEndAt || !label) return;
    const remaining = Math.max(0, sleepTimerEndAt - Date.now());
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    label.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  };
  tickLabel();
  sleepTickHandle = setInterval(tickLabel, 1000);
}

function fadeOutAndPause() {
  const dur = 4000;
  const start = engine.audio.volume;
  const t0 = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    engine.audio.volume = start * (1 - k);
    if (k < 1) requestAnimationFrame(tick);
    else { engine.audio.pause(); engine.audio.volume = start; }
  };
  requestAnimationFrame(tick);
}

function openLyricsFs() {
  lyricsFsOpen = true;
  const el = $('#lyricsFs');
  el?.classList.add('is-open');
  document.documentElement.classList.add('is-lyrics-fs');
  refreshLyricsFs();
  ensureLyricsRendered();
  if (lyricsRaf === null) startKaraoke();
  // Re-fit on viewport resize so lines never wrap after a rotation/resize.
  window.addEventListener('resize', fitLyricsLines, { passive: true });
  document.dispatchEvent(new CustomEvent('lyricsfs:open'));
}

function ensureLyricsRendered() {
  const fsInner = $('#lyricsFsInner') as HTMLElement | null;
  if (!fsInner) return;
  bindLyricsClick();
  if (activeLyrics) {
    if (activeLyrics !== lyricsRenderedBundle) buildLyricsLines(activeLyrics);
    return;
  }
  if (!currentTrackId) {
    fsInner.innerHTML = '<p class="lyrics-fs__line lyrics-fs__line--future">Press play to see the lyrics.</p>';
    return;
  }
  const t = TRACK_BY_ID.get(currentTrackId);
  if (!t) return;
  fsInner.innerHTML = '<p class="lyrics-fs__line lyrics-fs__line--future">Loading lyrics…</p>';
  loadLyrics(t).then(b => {
    activeLyrics = b;
    if (lyricsFsOpen) buildLyricsLines(b);
  }).catch(() => {
    if (lyricsFsOpen) fsInner.innerHTML = '<p class="lyrics-fs__line lyrics-fs__line--future">Lyrics unavailable.</p>';
  });
}

function closeLyricsFs() {
  lyricsFsOpen = false;
  $('#lyricsFs')?.classList.remove('is-open');
  document.documentElement.classList.remove('is-lyrics-fs');
  window.removeEventListener('resize', fitLyricsLines);
  document.dispatchEvent(new CustomEvent('lyricsfs:close'));
}

function refreshLyricsFs() {
  if (!lyricsFsOpen) return;
  const t = currentTrackId ? TRACK_BY_ID.get(currentTrackId) : null;
  const album = t ? ALBUM_BY_ID.get(t.album) : null;
  const cover = $('#lyricsFsCover') as HTMLImageElement | null;
  const title = $('#lyricsFsTitle');
  const albumEl = $('#lyricsFsAlbum');
  if (cover) cover.src = album?.cover ?? '/art/cover-panda-desiiignare.png';
  if (title) title.textContent = t?.title ?? '—';
  if (albumEl) albumEl.textContent = album?.name ?? 'bZ';
}

let currentQueueTab = 'up-next';
let currentQueueFilter: { kind: string; value: string } | null = null;
let queueIdleTimer: ReturnType<typeof setTimeout> | null = null;
let queueIdleDeadline = 0;
let queueIdleTicker: ReturnType<typeof setInterval> | null = null;
const QUEUE_IDLE_MS = 60_000;

function openQueuePanel() {
  queuePanelOpen = true;
  $('#queuePanel')?.classList.add('is-open');
  if (!currentQueueTab) currentQueueTab = 'up-next';
  renderQueueTab(currentQueueTab, currentQueueFilter);
  bumpQueueIdle();
}

function closeQueuePanel() {
  queuePanelOpen = false;
  $('#queuePanel')?.classList.remove('is-open');
  if (queueIdleTimer) { clearTimeout(queueIdleTimer); queueIdleTimer = null; }
  if (queueIdleTicker) { clearInterval(queueIdleTicker); queueIdleTicker = null; }
}

function bumpQueueIdle() {
  if (!queuePanelOpen) return;
  if (queueIdleTimer) clearTimeout(queueIdleTimer);
  queueIdleDeadline = Date.now() + QUEUE_IDLE_MS;
  queueIdleTimer = setTimeout(() => closeQueuePanel(), QUEUE_IDLE_MS);
  updateQueueIdleHint();
  if (!queueIdleTicker) {
    queueIdleTicker = setInterval(updateQueueIdleHint, 1000);
  }
}

function updateQueueIdleHint() {
  const hint = $('#queueIdleHint');
  if (!hint) return;
  const remain = Math.max(0, Math.round((queueIdleDeadline - Date.now()) / 1000));
  hint.textContent = `idle close in ${remain}s`;
}

interface QueueGroup { label: string; sub?: string; tracks: Track[]; }

function renderQueueTab(tab: string, filter: { kind: string; value: string } | null = null) {
  const body = $('#queueBody');
  if (!body) return;
  currentQueueTab = tab;
  currentQueueFilter = filter && filter.value ? filter : null;
  document.querySelectorAll<HTMLButtonElement>('.queue-panel__tab').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  if (tab === 'moods') {
    body.innerHTML = renderQueueGroupedView(buildMoodGroups(), 'moods', filter);
    return;
  }
  if (tab === 'albums') {
    body.innerHTML = renderQueueGroupedView(buildAlbumGroups(), 'albums', filter);
    return;
  }

  let list: Track[] = [];
  let emptyMsg = 'No tracks here yet.';
  if (tab === 'up-next') {
    const idx = TRACKS.findIndex(t => t.id === currentTrackId);
    if (idx >= 0) list = TRACKS.slice(idx + 1).concat(TRACKS.slice(0, idx)).slice(0, 12);
    else list = TRACKS.slice(0, 12);
    emptyMsg = 'No tracks queued.';
  } else if (tab === 'ai') {
    list = aiPicks(10).map(p => TRACK_BY_ID.get(p.trackId)).filter(Boolean) as Track[];
    emptyMsg = 'AI picks warming up — play a few tracks and they appear here.';
  } else if (tab === 'recent') {
    list = recentTracks.map(id => TRACK_BY_ID.get(id)).filter(Boolean) as Track[];
    emptyMsg = 'Tracks you played will appear here.';
  } else if (tab === 'top') {
    list = [...TRACKS]
      .map(t => ({ t, n: playCounts.get(t.id) ?? 0 }))
      .filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 16)
      .map(x => x.t);
    emptyMsg = 'Most-played tracks will surface here.';
  }
  body.innerHTML = list.length
    ? `<ul class="queue-list" role="list">${list.map(t => renderQueueRow(t, tab === 'ai')).join('')}</ul>`
    : `<p class="queue-panel__empty">${emptyMsg}</p>`;
}

function buildMoodGroups(): QueueGroup[] {
  const groups = new Map<string, Track[]>();
  for (const t of TRACKS) {
    const tags = TRACK_TAGS.get(t.id);
    if (!tags) continue;
    for (const m of tags.moods) {
      const arr = groups.get(m) ?? [];
      arr.push(t);
      groups.set(m, arr);
    }
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([label, tracks]) => ({ label, tracks }));
}

function buildAlbumGroups(): QueueGroup[] {
  return ALBUMS.map(a => ({
    label: a.name,
    sub: a.tagline ?? '',
    tracks: TRACKS.filter(t => t.album === a.id)
  })).filter(g => g.tracks.length > 0);
}

function renderQueueGroupedView(groups: QueueGroup[], kind: string, filter: { kind: string; value: string } | null) {
  if (!groups.length) return `<p class="queue-panel__empty">No groups yet.</p>`;
  const activeValue = filter?.kind === kind ? filter.value : groups[0].label;
  const chips = groups.map(g => {
    const isActive = g.label === activeValue;
    return `<button class="queue-chip${isActive ? ' is-active' : ''}" type="button" data-q-filter="${escapeHtml(kind)}" data-q-value="${escapeHtml(g.label)}">
      <span>${escapeHtml(g.label)}</span><span class="queue-chip__n">${g.tracks.length}</span>
    </button>`;
  }).join('');
  const active = groups.find(g => g.label === activeValue) ?? groups[0];
  const rows = active.tracks.map(t => renderQueueRow(t, false)).join('');
  return `<div class="queue-chips" role="tablist">${chips}</div>
    ${active.sub ? `<p class="queue-group__sub">${escapeHtml(active.sub)}</p>` : ''}
    <ul class="queue-list" role="list">${rows}</ul>`;
}

function renderQueueRow(t: Track, showRank: boolean): string {
  const album = ALBUM_BY_ID.get(t.album);
  const plays = playCounts.get(t.id) ?? 0;
  const isCurrent = t.id === currentTrackId;
  const cover = album?.cover ?? '/art/cover-panda-desiiignare.png';
  const rankAttr = showRank ? `data-q-rank="1"` : '';
  return `<li><button class="queue-row${isCurrent ? ' is-current' : ''}" data-q-track="${escapeHtml(t.id)}" type="button" ${rankAttr}>
    <img src="${cover}" alt="" width="44" height="44" loading="lazy" />
    <span class="queue-row__body">
      <span class="queue-row__title">${escapeHtml(t.title)}</span>
      <span class="queue-row__sub">${escapeHtml(album?.name ?? 'bZ')} · ${escapeHtml(t.vibe)}</span>
    </span>
    ${isCurrent ? '<span class="queue-row__now" aria-label="Now playing">▶</span>' : ''}
    ${plays > 0 && !isCurrent ? `<span class="queue-row__plays" aria-label="${plays} plays">${plays}×</span>` : ''}
  </button></li>`;
}

function openShortcuts() {
  shortcutsOpen = true;
  ($('#shortcuts') as HTMLDialogElement | null)?.showModal();
}
function closeShortcuts() {
  shortcutsOpen = false;
  ($('#shortcuts') as HTMLDialogElement | null)?.close();
}

function isStandalone(): boolean {
  if (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) return true;
  return Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
}

function installSnoozeActive(): boolean {
  if (localStorage.getItem(LS_KEYS.installDismissed) === '1') return true;
  const until = Number(localStorage.getItem(LS_KEYS.installSnoozeUntil) || 0);
  return Number.isFinite(until) && until > Date.now();
}

function showInstallBanner(reason: 'pwa' | 'ios' | 'force') {
  const banner = $('#installBanner');
  if (!banner) return;
  const accept = $('#installAccept') as HTMLButtonElement | null;
  const txt = $('#installBannerTxt');
  if (reason === 'ios') {
    if (txt) txt.textContent = 'Install bZ on iOS — tap Share, then Add to Home Screen.';
    if (accept) accept.hidden = true;
  } else {
    if (txt) txt.textContent = 'Install bZ as an app — instant launch + offline.';
    if (accept) accept.hidden = false;
  }
  banner.hidden = false;
}

function maybeShowInstallBanner() {
  const params = new URLSearchParams(location.search);
  const force = params.get('install') === '1';
  if (isStandalone() && !force) return;
  if (!force && installSnoozeActive()) return;

  const visits = (Number(localStorage.getItem(LS_KEYS.visits)) || 0) + 1;
  persist(LS_KEYS.visits, String(visits));

  if (force) { showInstallBanner('force'); return; }
  if (visits < 3) return;
  if (installPromptEvent) showInstallBanner('pwa');
  else if (isIOS()) showInstallBanner('ios');
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function bindInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPromptEvent = e;
    if (!installSnoozeActive() && !isStandalone()) showInstallBanner('pwa');
  });
  window.addEventListener('appinstalled', () => {
    persist(LS_KEYS.installDismissed, '1');
    const banner = $('#installBanner');
    if (banner) banner.hidden = true;
  });
  $('#installAccept')?.addEventListener('click', async () => {
    const e = installPromptEvent as BeforeInstallPromptEvent | null;
    const banner = $('#installBanner');
    if (!e) { if (banner) banner.hidden = true; return; }
    await e.prompt();
    await e.userChoice;
    installPromptEvent = null;
    if (banner) banner.hidden = true;
  });
  $('#installDismiss')?.addEventListener('click', () => {
    persist(LS_KEYS.installSnoozeUntil, String(Date.now() + INSTALL_SNOOZE_MS));
    const banner = $('#installBanner');
    if (banner) banner.hidden = true;
  });
  maybeShowInstallBanner();
}

function preloadNextTrack() {
  if (!currentTrackId) return;
  const idx = TRACKS.findIndex(t => t.id === currentTrackId);
  if (idx < 0) return;
  const next = TRACKS[(idx + 1) % TRACKS.length];
  if (!next) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'audio';
  link.href = next.file;
  document.head.appendChild(link);
  setTimeout(() => link.remove(), 8000);
  // also prefetch lyrics
  const ll = document.createElement('link');
  ll.rel = 'prefetch';
  ll.href = `/lyrics/${next.id}.json`;
  document.head.appendChild(ll);
  setTimeout(() => ll.remove(), 8000);
}

const paletteCache = new Map<string, { accent: string; violet: string }>();

function applyAlbumPalette(track: Track) {
  const album = ALBUM_BY_ID.get(track.album);
  if (!album) return;
  const cover = album.cover;
  if (paletteCache.has(cover)) {
    const p = paletteCache.get(cover)!;
    document.documentElement.style.setProperty('--accent', p.accent);
    document.documentElement.style.setProperty('--violet', p.violet);
    visualizer?.setAccent(p.accent);
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      const w = 32; const h = 32;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const buckets = new Map<string, { r: number; g: number; b: number; n: number; sat: number }>();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const lum = (max + min) / 2;
        if (lum < 32 || lum > 230) continue;
        const sat = max === 0 ? 0 : (max - min) / max;
        if (sat < 0.25) continue;
        const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
        const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, sat: 0 };
        cur.r += r; cur.g += g; cur.b += b; cur.n++; cur.sat = Math.max(cur.sat, sat);
        buckets.set(key, cur);
      }
      const arr = [...buckets.values()].sort((a, b) => b.n * (1 + b.sat) - a.n * (1 + a.sat));
      if (arr.length === 0) return;
      const top = arr[0];
      const accent = `rgb(${Math.round(top.r / top.n)}, ${Math.round(top.g / top.n)}, ${Math.round(top.b / top.n)})`;
      const second = arr[1] ?? top;
      const violet = `rgb(${Math.round(second.r / second.n)}, ${Math.round(second.g / second.n)}, ${Math.round(second.b / second.n)})`;
      paletteCache.set(cover, { accent, violet });
      document.documentElement.style.setProperty('--accent', accent);
      document.documentElement.style.setProperty('--violet', violet);
      visualizer?.setAccent(accent);
    } catch { /* tainted canvas — fallback to album.accent */ }
  };
  img.src = cover;
}

/** Filters tracks by title, vibe, album name, or lyrics content. */
function filterTracks(query: string): Track[] {
  if (!query.trim()) return [...TRACKS];
  const q = query.toLowerCase().trim();
  return TRACKS.filter(t => {
    const album = ALBUM_BY_ID.get(t.album);
    return (
      t.title.toLowerCase().includes(q) ||
      t.vibe.toLowerCase().includes(q) ||
      (album?.name.toLowerCase().includes(q) ?? false) ||
      t.lyrics.some(l => l.toLowerCase().includes(q))
    );
  });
}

function renderSearchResults(tracks: Track[]) {
  const results = $('#cmdkResults');
  const empty = $('#cmdkEmpty') as HTMLElement | null;
  const count = $('#cmdkCount');
  if (!results || !empty || !count) return;
  if (!tracks.length) {
    results.innerHTML = '';
    empty.hidden = false;
    count.textContent = '0 tracks';
    searchActiveIdx = -1;
    return;
  }
  empty.hidden = true;
  count.textContent = `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`;
  if (searchActiveIdx < 0) searchActiveIdx = 0;
  searchActiveIdx = Math.min(searchActiveIdx, tracks.length - 1);
  results.innerHTML = tracks.map((t, i) => {
    const album = ALBUM_BY_ID.get(t.album);
    const badge = t.id === currentTrackId ? '<span class="cmdk__item-badge">playing</span>' : '';
    const plays = playCounts.get(t.id) ?? 0;
    const playsBadge = `<span class="cmdk__item-plays" data-plays="${t.id}" aria-label="${plays} plays"${plays === 0 ? ' hidden' : ''}><svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span data-plays-num="${t.id}">${plays}</span></span>`;
    return `<div class="cmdk__item${i === searchActiveIdx ? ' cmdk__item--active' : ''}" data-idx="${i}" role="option" aria-selected="${i === searchActiveIdx ? 'true' : 'false'}" tabindex="-1">
      <img class="cmdk__item-cover" src="${album?.cover ?? '/art/cover-panda-desiiignare.png'}" alt="" width="40" height="40" loading="lazy" />
      <div class="cmdk__item-body">
        <div class="cmdk__item-title">${escapeHtml(t.title)}</div>
        <div class="cmdk__item-sub">${escapeHtml(album?.name ?? 'bZ')} · ${escapeHtml(t.vibe)}</div>
      </div>
      ${playsBadge}
      ${badge}
    </div>`;
  }).join('');
}

function openSearch() {
  searchOpen = true;
  $('#cmdk')?.classList.add('is-open');
  searchActiveIdx = 0;
  renderSearchResults(filterTracks(''));
  requestAnimationFrame(() => ($('#cmdkInput') as HTMLInputElement | null)?.focus());
}

function closeSearch() {
  searchOpen = false;
  $('#cmdk')?.classList.remove('is-open');
  const input = $('#cmdkInput') as HTMLInputElement | null;
  if (input) input.value = '';
}

function searchMove(dir: 1 | -1) {
  const input = $('#cmdkInput') as HTMLInputElement | null;
  const tracks = filterTracks(input?.value ?? '');
  if (!tracks.length) return;
  searchActiveIdx = (searchActiveIdx + dir + tracks.length) % tracks.length;
  renderSearchResults(tracks);
  $('#cmdkResults .cmdk__item--active')?.scrollIntoView({ block: 'nearest' });
}

function searchCommit() {
  const input = $('#cmdkInput') as HTMLInputElement | null;
  const tracks = filterTracks(input?.value ?? '');
  const t = tracks[Math.max(0, searchActiveIdx)];
  if (t) { closeSearch(); play(t); }
}

function showWisdomToast(track: Track) {
  if (!track.wisdom) return;
  if (wisdomTimer !== null) { clearTimeout(wisdomTimer); wisdomTimer = null; }
  const toast = $('#wisdomToast');
  if (!toast) return;
  toast.textContent = track.wisdom;
  toast.classList.add('is-visible');
  wisdomTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
    wisdomTimer = null;
  }, 4400);
}

function refreshNpPanel() {
  if (!npPanelOpen) return;
  const track = currentTrackId ? (TRACK_BY_ID.get(currentTrackId) ?? null) : null;
  const album = track ? ALBUM_BY_ID.get(track.album) : null;
  const cover = $('#npPanelCover') as HTMLImageElement | null;
  const label = $('#npPanelLabel');
  const title = $('#npPanelTitle');
  const wisdom = $('#npPanelWisdom');
  const bpmEl = $('#npPanelBpm');
  if (cover) cover.src = album?.cover ?? '/art/cover-panda-desiiignare.png';
  if (label) label.textContent = album?.name ?? 'bZ';
  if (title) title.textContent = track?.title ?? 'Press play';
  if (wisdom) wisdom.textContent = track?.wisdom ?? 'Play a track to see its wisdom.';
  const b = Math.round(engine.bpm);
  if (bpmEl) bpmEl.textContent = b > 30 ? `${b} BPM · ${hzToNote(engine.bpm)}` : '— BPM';
  document.querySelectorAll<HTMLButtonElement>('.np-panel__reverb-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.preset === activeReverb);
  });
}

function openNpPanel() {
  npPanelOpen = true;
  $('#npPanel')?.classList.add('is-open');
  refreshNpPanel();
}

function closeNpPanel() {
  npPanelOpen = false;
  $('#npPanel')?.classList.remove('is-open');
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.hostname === 'localhost') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.warn('sw register failed', err));
  });
}

async function attemptDeeplinkPlay(track: Track) {
  currentTrackId = track.id;
  renderAlbums($('#albums')!);
  renderNowPlaying(track);
  refreshShareLabel();
  pushTrackUrl(track);
  requestAnimationFrame(() => scrollToTrack(track.id));
  engine.play(track);
  updateMediaSession(track);
  activeLyrics = null;
  $('#karaoke')?.classList.remove('is-loaded');
  loadLyrics(track).then(b => {
    activeLyrics = b;
    $('#karaoke')?.classList.add('is-loaded');
    $('#karaoke')?.classList.toggle('is-estimated', b.source === 'estimated');
  });
  await new Promise(r => setTimeout(r, 280));
  if (engine.audio.paused) showAutoplayPrompt(track);
}

function parseTimestampParam(): number | null {
  const params = new URLSearchParams(location.search);
  const t = params.get('t');
  if (!t) return null;
  const m = t.match(/^(\d+)(?::(\d+))?$/);
  if (m) {
    const min = Number(m[1]);
    const sec = Number(m[2] ?? '0');
    if (Number.isFinite(min) && Number.isFinite(sec)) return min * 60 + sec;
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function bootstrapInitialRoute() {
  if (location.pathname === '/ashton/') {
    openAppeal({ pushHistory: false });
    return;
  }
  if (location.pathname === '/share-target') {
    void consumeShareTarget();
    applyDefaultMetadata();
    return;
  }
  pendingDeeplinkSeek = parseTimestampParam();
  const route = parseRouteFromUrl();
  if (!route) {
    applyDefaultMetadata();
    return;
  }
  if (route.kind === 'album') {
    setAlbumFilter(route.albumId, { push: false });
    requestAnimationFrame(() => scrollToAlbum(route.albumId));
    return;
  }
  const t = TRACK_BY_ID.get(route.trackId);
  if (!t) return;
  setAlbumFilter(t.album, { push: false });
  attemptDeeplinkPlay(t);
}

window.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('app')!;
  loadPersisted();
  setupShell(root);
  renderAlbums($('#albums')!);
  renderNowPlaying(null);
  bindUi();
  bindIntegrations();
  refreshLoopBtn();
  refreshShuffleBtn();
  bindInstallPrompt();
  void handleSpotifyCallback();
  bootstrapInitialRoute();
  registerServiceWorker();
  void refreshNotifyToggle();
  bindAiPlaylist();
  refreshAiPlaylist();
  mountAIChat({
    engine,
    onCommand: (cmd, args) => {
      const lc = cmd.toLowerCase();
      const parseTime = (s: string) => {
        if (!s) return NaN;
        if (s.includes(':')) {
          const [m, sec] = s.split(':').map(Number);
          return (m || 0) * 60 + (sec || 0);
        }
        const n = parseFloat(s);
        if (s.endsWith('%')) return ((engine.audio.duration || 0) * n) / 100;
        if (n > 0 && n < 1) return (engine.audio.duration || 0) * n;
        return n;
      };
      if (lc === 'play') { void engine.audio.play(); return true; }
      if (lc === 'pause') { engine.audio.pause(); return true; }
      if (lc === 'toggle') { ($('#btnPlay') as HTMLButtonElement | null)?.click(); return true; }
      if (lc === 'stop') { engine.audio.pause(); engine.audio.currentTime = 0; return true; }
      if (lc === 'next') { ($('#btnNext') as HTMLButtonElement | null)?.click(); return true; }
      if (lc === 'prev' || lc === 'previous' || lc === 'back') { ($('#btnPrev') as HTMLButtonElement | null)?.click(); return true; }
      if (lc === 'like') { ($('#btnLike') as HTMLButtonElement | null)?.click(); return true; }
      if (lc === 'seek') {
        const t = parseTime(args[0] || '');
        if (Number.isFinite(t) && t >= 0) {
          engine.audio.currentTime = Math.min(t, engine.audio.duration || t);
        }
        return true;
      }
      if (lc === 'speed') {
        const r = parseFloat(args[0] || '');
        if (Number.isFinite(r) && r >= 0.25 && r <= 4) engine.audio.playbackRate = r;
        return true;
      }
      if (lc === 'pitch') {
        const on = args[0]?.toLowerCase() !== 'off';
        try { (engine.audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = on; } catch { /* ignore */ }
        return true;
      }
      if (lc === 'sleep') {
        const arg = (args[0] || 'track').toLowerCase();
        const mins = parseFloat(arg);
        const ms = Number.isFinite(mins) ? mins * 60000 : (arg === 'album' ? 30 * 60000 : 5 * 60000);
        const startVol = engine.audio.volume;
        const t0 = performance.now();
        const fade = () => {
          const k = (performance.now() - t0) / ms;
          if (k >= 1) { engine.audio.pause(); engine.audio.volume = startVol; return; }
          engine.audio.volume = startVol * (1 - k);
          requestAnimationFrame(fade);
        };
        requestAnimationFrame(fade);
        return true;
      }
      if (lc === 'shuffle') { ($('#btnShuffle') as HTMLButtonElement | null)?.click(); return true; }
      if (lc === 'repeat' || lc === 'loop') { ($('#btnLoop') as HTMLButtonElement | null)?.click(); return true; }
      if (lc === 'viz') {
        const arg = (args[0] || '').toLowerCase();
        if (!arg || arg === 'next') { visualizer.cycleMode(); return true; }
        if (arg === 'prev') { visualizer.cycleModeReverse(); return true; }
        if (arg === 'surprise' || arg === 'random') {
          const modes = visualizer.modeCatalog();
          visualizer.setMode(modes[Math.floor(Math.random() * modes.length)]);
          return true;
        }
        try { visualizer.setMode(arg as VizMode); } catch { /* ignore */ }
        return true;
      }
      if (lc === 'trails') {
        const on = args[0]?.toLowerCase() !== 'off';
        try { (visualizer as unknown as { setTrails?: (b: boolean) => void }).setTrails?.(on); } catch { /* ignore */ }
        return true;
      }
      if (lc === 'palette') {
        if (!args[0] || args[0].toLowerCase() === 'album') { visualizer.setPalette(null); return true; }
        return true;
      }
      if (lc === 'eq') {
        const preset = (args[0] || '').toLowerCase();
        const presets: Record<string, { bass: number; mid: number; treble: number }> = {
          flat: { bass: 0, mid: 0, treble: 0 },
          bass: { bass: 6, mid: 0, treble: 0 },
          vocal: { bass: -2, mid: 4, treble: 1 },
          treble: { bass: 0, mid: 0, treble: 6 },
          loud: { bass: 5, mid: -1, treble: 4 }
        };
        if (presets[preset]) { engine.setEQ(presets[preset]); return true; }
        const n = parseFloat(args[1] || '');
        if (Number.isFinite(n) && (preset === 'bass' || preset === 'mid' || preset === 'treble')) {
          engine.setEQ({ [preset]: n } as Partial<{ bass: number; mid: number; treble: number }>);
        }
        return true;
      }
      if (lc === 'reverb') {
        const a = (args[0] || '').toLowerCase();
        const presets = ['dry', 'room', 'hall', 'cathedral', 'spring', 'plate'];
        if (presets.includes(a)) { engine.setReverbPreset(a as 'dry' | 'room' | 'hall' | 'cathedral' | 'spring' | 'plate'); return true; }
        if (a === 'wet') {
          const v = parseFloat(args[1] || '');
          if (Number.isFinite(v)) engine.setReverbWet(v);
        }
        return true;
      }
      if (lc === 'cast') { ($('#btnCast') as HTMLButtonElement | null)?.click(); return true; }
      if (lc === 'airplay') { ($('#btnAirplay') as HTMLButtonElement | null)?.click(); return true; }
      if (lc === 'snap') {
        const c = $('#bg') as HTMLCanvasElement | null;
        if (c) {
          c.toBlob(blob => {
            if (!blob) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `bz-viz-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(a.href);
          }, 'image/png');
        }
        return true;
      }
      if (lc === 'clip') {
        const secs = Math.max(2, Math.min(60, parseFloat(args[0] || '15')));
        const c = $('#bg') as HTMLCanvasElement | null;
        if (!c || !('captureStream' in c)) return true;
        const stream = (c as HTMLCanvasElement & { captureStream: (f: number) => MediaStream }).captureStream(30);
        const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
        const chunks: Blob[] = [];
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        rec.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `bz-clip-${Date.now()}.webm`;
          a.click();
          URL.revokeObjectURL(a.href);
        };
        rec.start();
        setTimeout(() => rec.stop(), secs * 1000);
        return true;
      }
      if (lc === 'debug') {
        document.body.classList.toggle('debug-on');
        return true;
      }
      return false;
    }
  });
  loadGlobalStats().then(() => refreshAiPlaylist());
  engine.audio.addEventListener('timeupdate', () => {
    if (!currentTrackId) return;
    if (engine.audio.currentTime >= 30) reportPlay(currentTrackId);
  });
});
