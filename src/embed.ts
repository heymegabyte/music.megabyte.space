// Embeddable track / album player.
//
// Rendered at `/embed/<albumSlug>` and `/embed/<albumSlug>/<trackSlug>` —
// the Cloudflare Worker rewrites both forms to `/embed.html`, which loads
// this entry as a module (`<script type="module" src="/src/embed.ts">`).
// Intended to be iframed by oEmbed consumers (Reddit, Discord card unfurls,
// Notion, blog posts), so it MUST:
//   1. Render synchronously after `DOMContentLoaded` — no spinner-flash.
//   2. Never throw uncaught into the iframe — render a branded fallback
//      surface for any failure mode (bad slug, decode error, network 404).
//   3. Work cross-origin under autoplay restrictions — first user gesture
//      kicks AudioContext + .play() inside the click handler so the
//      browser autoplay policy treats it as user-initiated.
//   4. Keep the chrome surface tight: cover · title · prev/play/next ·
//      scrub bar · time · deep-link to the full site.
//
// The full app surface (visualizer, lyrics, sharing, casting) lives on
// music.megabyte.space proper — clicking the cover / deep-link opens the
// canonical route in a new tab.
import './style.css';
import { AudioEngine } from './audio';
import { ALBUM_BY_ID, TRACK_BY_ID } from './data';
import type { Track, Album } from './types';

const SITE_ORIGIN = 'https://music.megabyte.space';
const FALLBACK_MSG_INVALID = 'This embed link is missing or invalid.';
const FALLBACK_MSG_ERROR = 'Something went wrong loading this track. Try the full player on music.megabyte.space.';

interface EmbedTrackTarget { kind: 'track'; track: Track; album: Album }
interface EmbedAlbumTarget { kind: 'album'; album: Album; tracks: Track[] }
type EmbedTarget = EmbedTrackTarget | EmbedAlbumTarget | null;

/** Parse `/embed/<album>` or `/embed/<album>/<track>` against the data
 *  catalog. Returns `null` if the slug shape is wrong or the album/track
 *  isn't registered. The worker is already canonicalizing the path, so
 *  this is the second line of defense — never trust the path blindly. */
function parseEmbedTarget(): EmbedTarget {
  const m = location.pathname.match(/^\/embed\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?\/?$/i);
  if (!m) return null;
  const [, albumSlug, trackSlug] = m;
  const album = ALBUM_BY_ID.get(albumSlug);
  if (!album) return null;
  if (trackSlug) {
    const track = TRACK_BY_ID.get(trackSlug);
    if (track && track.album === albumSlug) return { kind: 'track', track, album };
    return null;
  }
  const tracks = album.trackIds.map(id => TRACK_BY_ID.get(id)).filter(Boolean) as Track[];
  if (!tracks.length) return null;
  return { kind: 'album', album, tracks };
}

function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Render the branded fallback card. Used for invalid paths AND runtime
 *  errors — the iframe never goes blank. */
function fallback(host: HTMLElement, msg: string) {
  host.innerHTML = `
    <div class="embed-fallback">
      <p>${escapeHtml(msg)}</p>
      <a class="embed-fallback__link" href="${SITE_ORIGIN}/" target="_blank" rel="noopener">Open bZ on music.megabyte.space →</a>
    </div>
  `;
}

const root = document.getElementById('embedApp');
if (!root) {
  console.error('[embed] #embedApp host missing — bad embed.html shell');
} else {
  bootEmbed(root);
}

function bootEmbed(host: HTMLElement) {
  let target: EmbedTarget;
  try {
    target = parseEmbedTarget();
  } catch (err) {
    console.error('[embed] parseEmbedTarget threw', err);
    fallback(host, FALLBACK_MSG_ERROR);
    return;
  }

  if (!target) {
    fallback(host, FALLBACK_MSG_INVALID);
    return;
  }

  try {
    renderPlayer(host, target);
  } catch (err) {
    console.error('[embed] renderPlayer crashed', err);
    fallback(host, FALLBACK_MSG_ERROR);
  }
}

function renderPlayer(host: HTMLElement, target: NonNullable<EmbedTarget>) {
  const album = target.album;
  document.documentElement.style.setProperty('--accent', album.accent);
  document.documentElement.style.setProperty('--bg-primary', '#060610');

  // Album view = full track listing, single view = exactly one track.
  // `idx` is always a valid index into `playlist`, mod-wrapped on prev/next.
  const playlist: Track[] = target.kind === 'track' ? [target.track] : target.tracks;
  let idx = 0;
  const engine = new AudioEngine();

  const albumName = escapeHtml(album.name);
  const albumCover = escapeHtml(album.cover);
  const isAlbum = target.kind === 'album';
  const eyebrow = isAlbum ? 'album' : 'single';
  const titleCopy = isAlbum ? albumName : escapeHtml(target.track.title);
  const subline = isAlbum
    ? `${playlist.length} tracks · bZ`
    : `${albumName} · bZ`;
  const deepHref = isAlbum ? `${SITE_ORIGIN}/${album.id}` : `${SITE_ORIGIN}/${album.id}/${target.track.id}`;

  host.innerHTML = `
    <div class="embed" style="--accent: ${album.accent};">
      <a class="embed__cover" id="embedCover" href="${escapeHtml(deepHref)}" target="_blank" rel="noopener" aria-label="Open on music.megabyte.space">
        <img src="${albumCover}" alt="${albumName} cover" />
      </a>
      <div class="embed__body">
        <p class="embed__eyebrow">${eyebrow}</p>
        <h2 class="embed__title" id="embedTitle">${titleCopy}</h2>
        <p class="embed__sub" id="embedSub">${escapeHtml(subline)}</p>
        <div class="embed__transport">
          <button class="embed__btn" id="embedPrev" type="button" aria-label="Previous track" ${playlist.length < 2 ? 'hidden' : ''}>‹</button>
          <button class="embed__btn embed__btn--play" id="embedPlay" type="button" aria-label="Play / Pause"><span id="embedPlayIcon">▶</span></button>
          <button class="embed__btn" id="embedNext" type="button" aria-label="Next track" ${playlist.length < 2 ? 'hidden' : ''}>›</button>
          <div class="embed__bar" id="embedBar" role="slider" aria-label="Seek" tabindex="0"><div class="embed__fill" id="embedFill"></div></div>
          <span class="embed__time" id="embedTime">0:00 / 0:00</span>
        </div>
        <a class="embed__deep" href="${escapeHtml(deepHref)}" target="_blank" rel="noopener">music.megabyte.space →</a>
      </div>
    </div>
  `;

  const playIcon = document.getElementById('embedPlayIcon')!;
  const titleEl = document.getElementById('embedTitle')!;
  const subEl = document.getElementById('embedSub')!;
  const fillEl = document.getElementById('embedFill') as HTMLElement;
  const timeEl = document.getElementById('embedTime')!;
  const bar = document.getElementById('embedBar')!;

  function refreshTitle() {
    const t = playlist[idx];
    titleEl.textContent = t.title;
    subEl.textContent = isAlbum ? `${idx + 1}/${playlist.length} · ${album.name}` : `${album.name} · bZ`;
  }

  /** Switch the current track and (optionally) start playback. AudioEngine
   *  swallows autoplay-policy rejections internally; we still wrap to log
   *  any *other* play() failure (network, decode, abort). */
  async function load(i: number, autoplay: boolean) {
    idx = (i + playlist.length) % playlist.length;
    refreshTitle();
    try {
      if (autoplay) {
        await engine.play(playlist[idx]);
      } else {
        engine.audio.src = playlist[idx].file;
        engine.audio.load();
      }
    } catch (err) {
      console.error('[embed] load failed', err);
    }
  }

  // --- Transport wiring ---------------------------------------------------
  // Play button: drives playback directly via engine.play(track) instead of
  // engine.toggle() because the embed boots with audio.src preloaded (autoplay
  // false) which leaves engine.current === null — engine.toggle() early-returns
  // on null current. Calling engine.play(track) sets current + unlock() + play
  // synchronously inside the click event, which preserves the user gesture for
  // browser autoplay policy.
  document.getElementById('embedPlay')?.addEventListener('click', () => {
    if (engine.audio.paused) void engine.play(playlist[idx]);
    else engine.audio.pause();
  });
  document.getElementById('embedPrev')?.addEventListener('click', () => void load(idx - 1, true));
  document.getElementById('embedNext')?.addEventListener('click', () => void load(idx + 1, true));

  bar.addEventListener('click', e => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    engine.seekRatio((e.clientX - r.left) / r.width);
  });

  // Keyboard seek for the scrub bar (←/→ = ±5s, Home/End = jump).
  bar.addEventListener('keydown', e => {
    if (!engine.audio.duration) return;
    const step = 5;
    if (e.key === 'ArrowRight') { engine.audio.currentTime = Math.min(engine.audio.duration, engine.audio.currentTime + step); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { engine.audio.currentTime = Math.max(0, engine.audio.currentTime - step); e.preventDefault(); }
    else if (e.key === 'Home') { engine.audio.currentTime = 0; e.preventDefault(); }
    else if (e.key === 'End') { engine.audio.currentTime = engine.audio.duration - 0.01; e.preventDefault(); }
  });

  // Bubble audio-element errors (decode, network 404, MIME mismatch) into
  // the fallback surface ONLY for terminal failures — transient stalls
  // recover on their own.
  engine.audio.addEventListener('error', () => {
    const code = engine.audio.error?.code;
    console.error('[embed] audio element error', code, engine.audio.error?.message);
    // MEDIA_ERR_SRC_NOT_SUPPORTED (4) or MEDIA_ERR_DECODE (3) = fatal.
    if (code === 3 || code === 4) {
      fallback(host, FALLBACK_MSG_ERROR);
    }
  });

  // Reflect engine state into the chrome on every tick. Icon flips to the
  // pause glyph when playing — the Playwright suite asserts the exact
  // glyph as a proxy for "playback started".
  engine.on(() => {
    const s = engine.state();
    playIcon.textContent = s.playing ? '❚❚' : '▶';
    timeEl.textContent = `${fmtTime(s.currentTime)} / ${fmtTime(s.duration)}`;
    fillEl.style.width = s.duration ? `${(s.currentTime / s.duration) * 100}%` : '0%';
    if (engine.audio.ended && playlist.length > 1) void load(idx + 1, true);
  });

  void load(0, false);
  refreshTitle();
}
