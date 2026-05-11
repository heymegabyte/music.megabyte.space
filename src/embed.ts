import './style.css';
import { AudioEngine } from './audio';
import { ALBUMS, ALBUM_BY_ID, TRACK_BY_ID } from './data';
import type { Track, Album } from './types';

const SITE_ORIGIN = 'https://music.megabyte.space';

interface EmbedTrackTarget { kind: 'track'; track: Track; album: Album }
interface EmbedAlbumTarget { kind: 'album'; album: Album; tracks: Track[] }
type EmbedTarget = EmbedTrackTarget | EmbedAlbumTarget | null;

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

function fallback(host: HTMLElement, msg: string) {
  host.innerHTML = `
    <div class="embed-fallback">
      <p>${escapeHtml(msg)}</p>
      <a class="embed-fallback__link" href="${SITE_ORIGIN}/" target="_blank" rel="noopener">Open bZ on music.megabyte.space →</a>
    </div>
  `;
}

const target = parseEmbedTarget();
const root = document.getElementById('embedApp')!;

if (!target) {
  fallback(root, 'This embed link is missing or invalid.');
} else {
  const album = target.album;
  document.documentElement.style.setProperty('--accent', album.accent);
  document.documentElement.style.setProperty('--bg-primary', '#060610');

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

  root.innerHTML = `
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
          <div class="embed__bar" id="embedBar"><div class="embed__fill" id="embedFill"></div></div>
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
    titleEl.textContent = isAlbum ? t.title : t.title;
    subEl.textContent = isAlbum ? `${idx + 1}/${playlist.length} · ${album.name}` : `${album.name} · bZ`;
  }

  function load(i: number, autoplay: boolean) {
    idx = (i + playlist.length) % playlist.length;
    refreshTitle();
    if (autoplay) engine.play(playlist[idx]);
    else {
      engine.audio.src = playlist[idx].file;
      engine.audio.load();
    }
  }

  document.getElementById('embedPlay')?.addEventListener('click', () => {
    if (!engine.audio.src) load(idx, true);
    else engine.toggle();
  });
  document.getElementById('embedPrev')?.addEventListener('click', () => load(idx - 1, true));
  document.getElementById('embedNext')?.addEventListener('click', () => load(idx + 1, true));
  bar.addEventListener('click', e => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    engine.seekRatio((e.clientX - r.left) / r.width);
  });

  engine.on(() => {
    const s = engine.state();
    playIcon.textContent = s.playing ? '❚❚' : '▶';
    timeEl.textContent = `${fmtTime(s.currentTime)} / ${fmtTime(s.duration)}`;
    fillEl.style.width = s.duration ? `${(s.currentTime / s.duration) * 100}%` : '0%';
    if (engine.audio.ended && playlist.length > 1) load(idx + 1, true);
  });

  load(0, false);
  refreshTitle();
}
