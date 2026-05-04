import './style.css';
import { AudioEngine } from './audio';
import { Visualizer } from './visualizer';
import type { VizMode } from './visualizer';
import { ALBUMS, ALBUM_BY_ID, TRACKS, TRACK_BY_ID } from './data';
import type { Track } from './types';

const $ = <T extends HTMLElement>(sel: string, root: Document | HTMLElement = document) =>
  root.querySelector(sel) as T | null;

interface WhisperWord { w: string; s: number; e: number; line?: number; }
interface WhisperLine { s: number; e: number; text: string; }
type LyricsSource = 'whisper' | 'aligned' | 'estimated';
interface LyricsBundle { words?: WhisperWord[]; lines: WhisperLine[]; duration?: number; source: LyricsSource; }

const engine = new AudioEngine();
let visualizer: Visualizer;
let currentTrackId: string | null = null;
let hudRaf: number | null = null;
let lyricsRaf: number | null = null;
const lyricsCache = new Map<string, LyricsBundle | null>();
let activeLyrics: LyricsBundle | null = null;
let currentAlbumFilter: string | null = null;
let autoplayPromptTrack: Track | null = null;

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
  return `${SITE_ORIGIN}/og/${trackId}.jpg`;
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
  if (native) native.hidden = !('share' in navigator);
}

function openShare(kind: 'track' | 'album', id: string) {
  const t = buildShareTarget(kind, id);
  if (!t) return;
  shareCurrent = t;
  refreshShareDialog();
  const dialog = $('#share') as HTMLDialogElement | null;
  if (dialog && !dialog.open) dialog.showModal();
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
        <img class="brand__mark" src="/art/brand-mark.png" alt="" width="34" height="34" loading="eager" decoding="async" />
        <span class="brand__word">bZ</span>
      </a>
      <div class="topbar__title" aria-hidden="true">
        <span class="topbar__title-mute">now playing —</span>
        <span class="topbar__title-text" id="npChrome">press play</span>
      </div>
      <nav class="topbar__nav" aria-label="Site">
        <a id="lnkAppeal" href="/ashton/">appeal</a>
        <a href="https://mission.megabyte.space" rel="noopener">mission</a>
      </nav>
    </header>

    <main class="zune" id="zune">
      <aside class="rail" aria-label="Albums">
        <div class="albums" id="albums"></div>
      </aside>

      <section class="viz" aria-label="Live audio visualizer">
        <div class="viz__hero" aria-hidden="true">
          <span class="viz__hero-album" id="heroAlbum">BZ · CYAN FLAG</span>
          <h1 class="viz__hero-title" id="heroTitle">PRESS PLAY</h1>
          <p class="viz__hero-vibe" id="heroVibe">Web Audio API live. Hard but holy.</p>
        </div>

        <div class="karaoke" id="karaoke" aria-live="polite" aria-label="Karaoke lyrics">
          <p class="karaoke__line karaoke__line--prev" id="karPrev"></p>
          <p class="karaoke__line karaoke__line--cur" id="karCur"></p>
          <p class="karaoke__line karaoke__line--next" id="karNext"></p>
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
          <button class="hud__mode-btn" id="modeBtn" type="button" aria-label="Visualizer mode">composite</button>
        </div>

        <div class="beat" id="beatDot" aria-hidden="true"></div>
      </section>
    </main>

    <footer class="transport" aria-label="Playback transport">
      <div class="transport__np" id="transportNp">
        <img class="transport__np-cover" id="transportNpCover" src="/art/cover-panda-desiiignare.png" alt="" width="40" height="40" />
        <div class="transport__np-meta">
          <span class="transport__np-title" id="transportNpTitle">Press play</span>
          <span class="transport__np-sub" id="transportNpSub">bZ</span>
        </div>
      </div>
      <div class="transport__controls">
        <button id="btnPrev" class="round" type="button" aria-label="Previous">‹</button>
        <button id="btnPlay" class="round round--lg" type="button" aria-label="Play / Pause"><span id="playIcon">▶</span></button>
        <button id="btnNext" class="round" type="button" aria-label="Next">›</button>
      </div>
      <div class="transport__progress">
        <span class="transport__time transport__time--now" id="transportNow">0:00</span>
        <div class="transport__bar" id="bar" aria-label="Seek" role="slider" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0">
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
        <button id="btnShare" class="link-btn link-btn--icon" type="button" aria-label="Share now playing">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          <span>share</span>
        </button>
        <button id="btnLyrics" class="link-btn link-btn--icon" type="button" aria-label="Toggle lyrics">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/></svg>
          <span>lyrics</span>
        </button>
      </div>
    </footer>

    <dialog class="drawer" id="drawer">
      <button class="drawer__close" id="drawerClose" type="button" aria-label="Close">✕</button>
      <h3 class="drawer__title" id="drawerTitle">Lyrics</h3>
      <div class="drawer__body" id="drawerBody"></div>
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

    <dialog class="autoplay" id="autoplayPrompt" aria-labelledby="apTitle">
      <div class="autoplay__card">
        <img class="autoplay__cover" id="apCover" src="" alt="" width="120" height="120" />
        <div class="autoplay__body">
          <p class="autoplay__eyebrow">tap to play</p>
          <h3 class="autoplay__title" id="apTitle">—</h3>
          <p class="autoplay__meta" id="apMeta">—</p>
          <div class="autoplay__row">
            <button id="apPlay" class="autoplay__play" type="button" aria-label="Play track">
              <span class="autoplay__play-icon">▶</span>
              <span>Play</span>
            </button>
            <button id="apClose" class="autoplay__skip" type="button" aria-label="Dismiss">Not now</button>
          </div>
        </div>
      </div>
    </dialog>
  `;
}

function renderAlbums(host: HTMLElement) {
  const visible = currentAlbumFilter
    ? ALBUMS.filter(a => a.id === currentAlbumFilter)
    : [...ALBUMS].sort((a, b) => (b.releasedAt ?? '').localeCompare(a.releasedAt ?? ''));
  const back = currentAlbumFilter
    ? `<a class="albums__back" data-albums-back href="/" aria-label="Back to all albums">← all albums</a>`
    : '';
  host.innerHTML = back + visible.map(album => {
    const tracks = album.trackIds.map(id => TRACK_BY_ID.get(id)).filter(Boolean) as Track[];
    return `
      <section class="album" data-album="${album.id}" style="--album-accent: ${album.accent};">
        <header class="album__head">
          <a class="album__cover" data-album-link="${album.id}" href="${albumPath(album.id)}" aria-label="Open ${album.name}">
            <img src="${album.cover}" alt="${album.name} cover art" loading="lazy" decoding="async" />
          </a>
          <div class="album__head-meta">
            <p class="album__eyebrow">album${album.releasedAt ? ` · ${album.releasedAt}` : ''}</p>
            <h3 class="album__title">${album.name}</h3>
            <p class="album__tagline">${album.tagline}</p>
            <p class="album__count">${tracks.length} tracks · bZ</p>
          </div>
          <button class="share-chip share-chip--head" type="button" data-share-album="${album.id}" aria-label="Share ${album.name}">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            <span>Share</span>
          </button>
        </header>
        <ol class="album__tracks" role="list">
          ${tracks.map((t, idx) => `
            <li class="trackrow-wrap">
              <a class="trackrow ${t.id === currentTrackId ? 'is-current' : ''}" data-track="${t.id}" href="${trackPath(t)}">
                <span class="trackrow__num"><span class="trackrow__bars" aria-hidden="true"><i></i><i></i><i></i></span><span class="trackrow__num-txt">${(idx + 1).toString().padStart(2, '0')}</span></span>
                <span class="trackrow__title">${t.title}</span>
                <span class="trackrow__vibe">${t.vibe}</span>
              </a>
              <button class="share-chip share-chip--row" type="button" data-share-track="${t.id}" aria-label="Share ${t.title}">
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              </button>
            </li>
          `).join('')}
        </ol>
      </section>
    `;
  }).join('');
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
  if (npChrome) npChrome.textContent = track ? `${track.title} — ${album?.name ?? 'bZ'}` : 'press play';
  const npCover = $('#transportNpCover') as HTMLImageElement | null;
  const npTitle = $('#transportNpTitle');
  const npSub = $('#transportNpSub');
  if (npCover) npCover.src = album?.cover ?? '/art/cover-panda-desiiignare.png';
  if (npTitle) npTitle.textContent = track?.title ?? 'Press play';
  if (npSub) npSub.textContent = track ? (album?.name ?? 'bZ') : 'bZ';
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
  const slice = dur / Math.max(1, track.lyrics.length);
  const lines: WhisperLine[] = track.lyrics.map((text, i) => ({
    s: i * slice + 1.2,
    e: (i + 1) * slice + 1.2,
    text
  }));
  const bundle: LyricsBundle = { lines, duration: dur, source: 'estimated' };
  lyricsCache.set(track.id, bundle);
  return bundle;
}

function startKaraoke() {
  if (lyricsRaf !== null) return;
  const prev = $('#karPrev');
  const cur = $('#karCur');
  const next = $('#karNext');

  let lastBundleId: object | null = null; // identity of activeLyrics when cur HTML last built
  let lastLineIdx = -2;
  let curWordSpans: HTMLSpanElement[] = [];
  let curLineWords: WhisperWord[] = []; // words belonging to the current line
  let lastActiveWordIdx = -2;

  const buildCurLine = (lineIdx: number, lineText: string, words: WhisperWord[] | undefined) => {
    if (!cur) return;
    if (!words || !words.length) {
      cur.textContent = lineText;
      curWordSpans = [];
      curLineWords = [];
      lastActiveWordIdx = -2;
      return;
    }
    // Filter to words for this line; fall back to time-overlap if line tag missing
    let lineWords = words.filter(w => (w.line ?? -1) === lineIdx);
    if (!lineWords.length && activeLyrics) {
      const ln = activeLyrics.lines[lineIdx];
      if (ln) lineWords = words.filter(w => w.s >= ln.s - 0.2 && w.s < ln.e + 0.2);
    }
    if (!lineWords.length) {
      cur.textContent = lineText;
      curWordSpans = [];
      curLineWords = [];
      lastActiveWordIdx = -2;
      return;
    }
    curLineWords = lineWords;
    const html = lineWords
      .map((w, i) => `<span class="karaoke__w" data-idx="${i}">${escapeHtml(w.w)}</span>`)
      .join(' ');
    cur.innerHTML = html;
    curWordSpans = Array.from(cur.querySelectorAll<HTMLSpanElement>('.karaoke__w'));
    lastActiveWordIdx = -2;
  };

  const tick = () => {
    if (!activeLyrics || !prev || !cur || !next) {
      lyricsRaf = requestAnimationFrame(tick);
      return;
    }
    const t = engine.audio.currentTime;
    const lines = activeLyrics.lines;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (t >= lines[i].s && t < lines[i].e) { idx = i; break; }
      if (t < lines[i].s) { idx = i - 1; break; }
    }
    if (idx === -1) idx = lines.length - 1;
    const prevLine = idx - 1 >= 0 ? lines[idx - 1].text : '';
    const curLine = idx >= 0 ? lines[idx].text : (lines[0]?.text ?? '');
    const nextLine = idx + 1 < lines.length ? lines[idx + 1].text : '';
    if (prev.textContent !== prevLine) prev.textContent = prevLine;
    if (next.textContent !== nextLine) next.textContent = nextLine;

    // Rebuild current line HTML on bundle/line change
    const bundleChanged = (lastBundleId !== activeLyrics);
    if (bundleChanged || lastLineIdx !== idx) {
      const curIdx = idx >= 0 ? idx : 0;
      buildCurLine(curIdx, curLine, activeLyrics.words);
      lastBundleId = activeLyrics;
      lastLineIdx = idx;
    }

    // Per-frame: highlight active word if we have spans for the current line
    if (curWordSpans.length && curLineWords.length) {
      let active = -1;
      for (let i = 0; i < curLineWords.length; i++) {
        const w = curLineWords[i];
        if (t >= w.s && t < w.e) { active = i; break; }
        if (t < w.s) { active = i - 1; break; }
      }
      if (active === -1 && t >= curLineWords[curLineWords.length - 1].e) active = curLineWords.length - 1;
      if (active !== lastActiveWordIdx) {
        for (let i = 0; i < curWordSpans.length; i++) {
          const span = curWordSpans[i];
          const past = i < active;
          const now = i === active;
          span.classList.toggle('karaoke__w--past', past);
          span.classList.toggle('karaoke__w--active', now);
        }
        lastActiveWordIdx = active;
      }
    }

    lyricsRaf = requestAnimationFrame(tick);
  };
  lyricsRaf = requestAnimationFrame(tick);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch =>
    ch === '&' ? '&amp;'
    : ch === '<' ? '&lt;'
    : ch === '>' ? '&gt;'
    : ch === '"' ? '&quot;'
    : '&#39;');
}

async function play(track: Track) {
  currentTrackId = track.id;
  pushTrackUrl(track);
  renderAlbums($('#albums')!);
  renderNowPlaying(track);
  engine.play(track);
  updateMediaSession(track);
  scrollCurrentIntoView();
  activeLyrics = null;
  $('#karaoke')?.classList.remove('is-loaded');
  activeLyrics = await loadLyrics(track);
  $('#karaoke')?.classList.add('is-loaded');
  $('#karaoke')?.classList.toggle('is-estimated', activeLyrics.source === 'estimated');
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
  navigator.mediaSession.setActionHandler('play', () => engine.toggle());
  navigator.mediaSession.setActionHandler('pause', () => engine.toggle());
  navigator.mediaSession.setActionHandler('previoustrack', () => nextTrack(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack(1));
  navigator.mediaSession.setActionHandler('seekbackward', d => {
    engine.audio.currentTime = Math.max(0, engine.audio.currentTime - (d?.seekOffset ?? 10));
  });
  navigator.mediaSession.setActionHandler('seekforward', d => {
    engine.audio.currentTime = Math.min(engine.audio.duration || 0, engine.audio.currentTime + (d?.seekOffset ?? 10));
  });
  navigator.mediaSession.setActionHandler('seekto', d => {
    if (typeof d.seekTime === 'number') engine.audio.currentTime = d.seekTime;
  });
}

function openDrawer(title: string, html: string) {
  const drawer = $('#drawer') as HTMLDialogElement | null;
  if (!drawer) return;
  $('#drawerTitle')!.textContent = title;
  $('#drawerBody')!.innerHTML = html;
  if (!drawer.open) drawer.showModal();
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

  const drawWave = () => {
    if (!wave || !wctx || !engine.timeData?.length) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wave.clientWidth, h = wave.clientHeight;
    if (wave.width !== w * dpr || wave.height !== h * dpr) {
      wave.width = Math.max(1, w * dpr);
      wave.height = Math.max(1, h * dpr);
    }
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wctx.clearRect(0, 0, w, h);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00e5ff';
    const td = engine.timeData;
    const len = td.length;
    const step = Math.max(1, Math.floor(len / w));
    wctx.strokeStyle = accent;
    wctx.lineWidth = 1.4;
    wctx.globalAlpha = 0.55;
    wctx.beginPath();
    for (let x = 0; x < w; x++) {
      const i = Math.min(len - 1, x * step);
      const v = (td[i] - 128) / 128;
      const y = h / 2 + v * (h / 2 - 1);
      if (x === 0) wctx.moveTo(x, y);
      else wctx.lineTo(x, y);
    }
    wctx.stroke();
    wctx.globalAlpha = 1;
  };

  const tick = () => {
    const m = visualizer.audioMeters();
    if (bpmEl) bpmEl.textContent = m.bpm > 30 ? Math.round(m.bpm).toString() : '—';
    if (peakEl) peakEl.textContent = fmtHz(m.peakHz);
    if (keyEl) keyEl.textContent = hzToNote(m.peakHz);
    if (timeEl) {
      const a = engine.audio;
      const cur = fmtClock(a.currentTime || 0);
      const tot = a.duration && Number.isFinite(a.duration) ? fmtClock(a.duration) : '—:—';
      timeEl.textContent = `${cur} / ${tot}`;
    }
    const fps = visualizer.fps();
    lastFps = lastFps * 0.7 + fps * 0.3;
    if (fpsEl) fpsEl.textContent = Math.round(lastFps).toString();
    if (vuLEl) vuLEl.style.width = `${Math.min(100, m.ch.l * 140)}%`;
    if (vuREl) vuREl.style.width = `${Math.min(100, m.ch.r * 140)}%`;
    if (bandBass) bandBass.style.height = `${Math.min(100, m.bass * 130)}%`;
    if (bandMid) bandMid.style.height = `${Math.min(100, m.mid * 130)}%`;
    if (bandTreb) bandTreb.style.height = `${Math.min(100, m.treble * 130)}%`;
    if (beatDot) beatDot.style.opacity = (0.15 + m.beat * 0.85).toString();
    drawWave();
    hudRaf = requestAnimationFrame(tick);
  };
  hudRaf = requestAnimationFrame(tick);
}

function bindUi() {
  const bg = $('#bg') as HTMLCanvasElement;
  visualizer = new Visualizer(bg, engine);
  visualizer.setAccent(ALBUMS[0].accent);
  visualizer.start();
  visualizer.setAutoCycle(true);

  const modeBtn = $('#modeBtn');
  visualizer.onModeChange((m: VizMode) => {
    if (modeBtn) modeBtn.textContent = m;
  });
  if (modeBtn) modeBtn.textContent = visualizer.currentMode();
  modeBtn?.addEventListener('click', () => visualizer.cycleMode());

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
    try {
      await (navigator as Navigator & { share: (d: ShareData) => Promise<void> }).share({
        title: `${shareCurrent.title} — bZ`,
        text: `${shareCurrent.title} — bZ`,
        url: shareCurrent.shareUrl
      });
    } catch { /* user dismissed or unsupported */ }
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

  $('#btnPrev')?.addEventListener('click', () => nextTrack(-1));
  $('#btnNext')?.addEventListener('click', () => nextTrack(1));
  $('#btnPlay')?.addEventListener('click', () => {
    if (!currentTrackId) {
      play(TRACKS[0]);
      return;
    }
    engine.toggle();
  });
  ($('#vol') as HTMLInputElement)?.addEventListener('input', e => {
    engine.setVolume(Number((e.target as HTMLInputElement).value));
  });

  const bar = $('#bar');
  bar?.addEventListener('click', e => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    engine.seekRatio((e.clientX - r.left) / r.width);
  });
  bar?.addEventListener('mousemove', e => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    bar.style.setProperty('--bar-hover', `${ratio * 100}%`);
    const hoverTimeEl = $('#transportHoverTime');
    if (hoverTimeEl) {
      const dur = engine.audio.duration;
      hoverTimeEl.textContent = Number.isFinite(dur) ? fmtTime(dur * ratio) : '0:00';
      hoverTimeEl.style.left = `${ratio * 100}%`;
    }
  });

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

  $('#btnLyrics')?.addEventListener('click', () => {
    const t = currentTrackId ? TRACK_BY_ID.get(currentTrackId) : null;
    if (!t) {
      openDrawer('Lyrics', `<p>Pick a song first — every track has its own verse stash.</p>`);
      return;
    }
    const lines = (activeLyrics?.lines.length ? activeLyrics.lines.map(l => l.text) : t.lyrics);
    const note = activeLyrics?.source === 'whisper'
      ? '<p class="lyrics__note">Word timings via Whisper.</p>'
      : activeLyrics?.source === 'aligned'
        ? '<p class="lyrics__note">Per-track alignment from real audio durations.</p>'
        : '<p class="lyrics__note">Estimated timings — alignment pending.</p>';
    openDrawer(`${t.title} — lyrics`, `${note}<ol class="lyrics">${lines.map(line => `<li>${line}</li>`).join('')}</ol>`);
  });

  $('#drawerClose')?.addEventListener('click', () => ($('#drawer') as HTMLDialogElement)?.close());
  $('#drawer')?.addEventListener('click', e => {
    if ((e.target as HTMLElement).id === 'drawer') ($('#drawer') as HTMLDialogElement)?.close();
  });

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

  document.addEventListener('keydown', e => {
    if (e.target && (e.target as HTMLElement).matches('input, textarea, select')) return;
    if (e.code === 'Space') { e.preventDefault(); $('#btnPlay')?.click(); }
    else if (e.code === 'ArrowRight') nextTrack(1);
    else if (e.code === 'ArrowLeft') nextTrack(-1);
    else if (e.code === 'KeyV') visualizer.cycleMode();
    else if (e.code === 'KeyL') $('#btnLyrics')?.click();
  });

  engine.on(() => {
    const s = engine.state();
    const playIcon = $('#playIcon');
    if (playIcon) playIcon.textContent = s.playing ? '❚❚' : '▶';
    const now = $('#transportNow');
    const total = $('#transportTotal');
    if (now) now.textContent = fmtTime(s.currentTime);
    if (total) total.textContent = fmtTime(s.duration);
    const fill = $('#transportFill') as HTMLElement | null;
    const thumb = $('#transportThumb') as HTMLElement | null;
    const buf = $('#transportBuffer') as HTMLElement | null;
    const ratio = s.duration ? s.currentTime / s.duration : 0;
    const bar = $('#bar');
    if (fill) fill.style.width = `${ratio * 100}%`;
    if (thumb) thumb.style.left = `${ratio * 100}%`;
    if (bar) bar.setAttribute('aria-valuenow', ratio.toFixed(3));
    if (buf && engine.audio.buffered.length) {
      const end = engine.audio.buffered.end(engine.audio.buffered.length - 1);
      buf.style.width = `${s.duration ? (end / s.duration) * 100 : 0}%`;
    }
    if (s.playing) document.documentElement.classList.add('is-playing');
    else document.documentElement.classList.remove('is-playing');
    if (engine.audio.ended) nextTrack(1);
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
    play
  };
}

function nextTrack(dir: 1 | -1) {
  const idx = TRACKS.findIndex(t => t.id === currentTrackId);
  const next = TRACKS[(idx + dir + TRACKS.length) % TRACKS.length];
  if (next) play(next);
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

function bootstrapInitialRoute() {
  if (location.pathname === '/ashton/') {
    openAppeal({ pushHistory: false });
    return;
  }
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
  setupShell(root);
  renderAlbums($('#albums')!);
  renderNowPlaying(null);
  bindUi();
  bootstrapInitialRoute();
  registerServiceWorker();
});
