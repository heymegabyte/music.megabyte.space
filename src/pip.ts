// Document Picture-in-Picture mini-player.
// Pops a real OS-level floating window (Chrome 116+) cloning the now-playing UI:
// album art + title + transport. Survives tab switches, Spaces, Mission Control.
// Sub-frame messaging via shared `localStorage` events plus direct method calls
// against the host document — both windows share the same JS realm so we pass
// references freely.

import { fmtTime } from './format';

export interface PipController {
  isSupported: boolean;
  isOpen(): boolean;
  toggle(): Promise<void>;
  close(): void;
  syncTrack(opts: { title: string; artist: string; cover: string; album: string }): void;
  syncPlayState(playing: boolean): void;
  syncProgress(position: number, duration: number): void;
  syncPalette(opts: { bg: string; ink: string; accent: string }): void;
}

export interface PipHooks {
  onPlayPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
}

interface PipApiWindow extends Window {
  documentPictureInPicture?: {
    requestWindow: (opts: {
      width?: number;
      height?: number;
      preferInitialWindowPlacement?: boolean;
    }) => Promise<Window>;
    window: Window | null;
  };
}

const SUPPORTED = typeof window !== 'undefined' && 'documentPictureInPicture' in window;

export function createPipController(hooks: PipHooks): PipController {
  let pipWindow: Window | null = null;
  let coverEl: HTMLImageElement | null = null;
  let titleEl: HTMLElement | null = null;
  let artistEl: HTMLElement | null = null;
  let albumEl: HTMLElement | null = null;
  let playBtn: HTMLButtonElement | null = null;
  let progressFill: HTMLElement | null = null;
  let progressNow: HTMLElement | null = null;
  let progressTotal: HTMLElement | null = null;
  let progressTrack: HTMLElement | null = null;
  let lastTrack: { title: string; artist: string; cover: string; album: string } | null = null;
  let lastPalette: { bg: string; ink: string; accent: string } = {
    bg: '#06030f',
    ink: '#f4ecd8',
    accent: '#a586ff'
  };
  let lastPlaying = false;
  let lastPosition = 0;
  let lastDuration = 0;

  function close(): void {
    if (pipWindow && !pipWindow.closed) {
      try {
        pipWindow.close();
      } catch {
        /* noop */
      }
    }
    pipWindow = null;
    coverEl = titleEl = artistEl = albumEl = null;
    playBtn = null;
    progressFill = progressNow = progressTotal = progressTrack = null;
  }

  function buildDocument(win: Window): void {
    const doc = win.document;
    doc.documentElement.lang = 'en';
    doc.title = 'bZ — Mini player';

    const style = doc.createElement('style');
    style.textContent = `
      :root { color-scheme: dark; --bg:${lastPalette.bg}; --ink:${lastPalette.ink}; --accent:${lastPalette.accent}; }
      html,body { margin:0; padding:0; height:100%; background:var(--bg); color:var(--ink);
        font-family: 'Sora', system-ui, -apple-system, sans-serif; -webkit-font-smoothing:antialiased; }
      .pip { display:flex; flex-direction:column; height:100%; padding:14px; gap:12px; box-sizing:border-box; }
      .pip__art { position:relative; aspect-ratio:1/1; width:100%; max-width:240px; align-self:center;
        border-radius:14px; overflow:hidden; box-shadow:0 18px 48px rgba(0,0,0,0.55); background:#000; }
      .pip__art img { width:100%; height:100%; object-fit:cover; display:block; }
      .pip__art::after { content:''; position:absolute; inset:0; box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06); border-radius:inherit; pointer-events:none; }
      .pip__meta { display:flex; flex-direction:column; gap:2px; min-width:0; }
      .pip__title { font-size:15px; font-weight:600; letter-spacing:-0.01em; margin:0;
        white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pip__artist { font-size:12px; opacity:0.78; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pip__album { font-size:11px; opacity:0.55; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .pip__progress { display:flex; flex-direction:column; gap:4px; }
      .pip__bar { position:relative; height:4px; border-radius:99px; background:rgba(255,255,255,0.12); cursor:pointer; }
      .pip__fill { position:absolute; inset:0 auto 0 0; width:0%; background:var(--accent); border-radius:inherit;
        transition:width 120ms linear; }
      .pip__times { display:flex; justify-content:space-between; font-size:10px; opacity:0.65; font-variant-numeric:tabular-nums; }
      .pip__transport { display:flex; align-items:center; justify-content:center; gap:14px; margin-top:auto; }
      .pip__btn { width:38px; height:38px; border:0; border-radius:50%; background:rgba(255,255,255,0.06);
        color:var(--ink); display:grid; place-items:center; cursor:pointer; transition:background 120ms,transform 120ms; }
      .pip__btn:hover { background:rgba(255,255,255,0.13); }
      .pip__btn:active { transform:scale(0.92); }
      .pip__btn--play { width:52px; height:52px; background:var(--accent); color:#06030f; }
      .pip__btn--play:hover { background:var(--accent); filter:brightness(1.08); }
      .pip__btn svg { width:16px; height:16px; }
      .pip__btn--play svg { width:20px; height:20px; }
      @media (prefers-reduced-motion: reduce) { .pip__fill { transition:none; } .pip__btn { transition:none; } }
    `;
    doc.head.appendChild(style);

    const root = doc.createElement('div');
    root.className = 'pip';
    root.innerHTML = `
      <div class="pip__art"><img id="pipCover" alt="" /></div>
      <div class="pip__meta">
        <p class="pip__title" id="pipTitle">—</p>
        <p class="pip__artist" id="pipArtist">—</p>
        <p class="pip__album" id="pipAlbum">—</p>
      </div>
      <div class="pip__progress">
        <div class="pip__bar" id="pipBar" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
          <div class="pip__fill" id="pipFill"></div>
        </div>
        <div class="pip__times"><span id="pipNow">0:00</span><span id="pipTotal">0:00</span></div>
      </div>
      <div class="pip__transport">
        <button class="pip__btn" id="pipPrev" type="button" aria-label="Previous">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
        </button>
        <button class="pip__btn pip__btn--play" id="pipPlay" type="button" aria-label="Play / pause">
          <svg id="pipPlayIcon" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <button class="pip__btn" id="pipNext" type="button" aria-label="Next">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
        </button>
      </div>
    `;
    doc.body.appendChild(root);

    coverEl = doc.getElementById('pipCover') as HTMLImageElement;
    titleEl = doc.getElementById('pipTitle');
    artistEl = doc.getElementById('pipArtist');
    albumEl = doc.getElementById('pipAlbum');
    playBtn = doc.getElementById('pipPlay') as HTMLButtonElement;
    progressFill = doc.getElementById('pipFill');
    progressNow = doc.getElementById('pipNow');
    progressTotal = doc.getElementById('pipTotal');
    progressTrack = doc.getElementById('pipBar');
    const prevBtn = doc.getElementById('pipPrev') as HTMLButtonElement | null;
    const nextBtn = doc.getElementById('pipNext') as HTMLButtonElement | null;

    playBtn?.addEventListener('click', () => hooks.onPlayPause());
    prevBtn?.addEventListener('click', () => hooks.onPrev());
    nextBtn?.addEventListener('click', () => hooks.onNext());
    progressTrack?.addEventListener('click', (e: Event) => {
      if (!progressTrack || !lastDuration) return;
      const evt = e as MouseEvent;
      const rect = progressTrack.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
      hooks.onSeek(ratio * lastDuration);
    });
    progressTrack?.addEventListener('keydown', (e: Event) => {
      const evt = e as KeyboardEvent;
      if (evt.key === 'ArrowLeft') {
        hooks.onSeek(Math.max(0, lastPosition - 5));
        evt.preventDefault();
      }
      if (evt.key === 'ArrowRight') {
        hooks.onSeek(Math.min(lastDuration, lastPosition + 5));
        evt.preventDefault();
      }
      if (evt.key === ' ' || evt.key === 'Enter') {
        hooks.onPlayPause();
        evt.preventDefault();
      }
    });

    if (lastTrack) syncTrack(lastTrack);
    syncPlayState(lastPlaying);
    syncProgress(lastPosition, lastDuration);
  }

  function syncTrack(opts: { title: string; artist: string; cover: string; album: string }): void {
    lastTrack = opts;
    if (!pipWindow || pipWindow.closed) return;
    if (coverEl) {
      coverEl.src = opts.cover;
      coverEl.alt = opts.title;
    }
    if (titleEl) titleEl.textContent = opts.title;
    if (artistEl) artistEl.textContent = opts.artist;
    if (albumEl) albumEl.textContent = opts.album;
    if (pipWindow.document) pipWindow.document.title = `${opts.title} — bZ`;
  }

  function syncPlayState(playing: boolean): void {
    lastPlaying = playing;
    if (!pipWindow || pipWindow.closed || !playBtn) return;
    const icon = pipWindow.document.getElementById('pipPlayIcon');
    if (icon) {
      icon.innerHTML = playing
        ? '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>'
        : '<polygon points="5 3 19 12 5 21 5 3"/>';
    }
    playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  function syncProgress(position: number, duration: number): void {
    lastPosition = position;
    lastDuration = duration;
    if (!pipWindow || pipWindow.closed) return;
    const ratio = duration > 0 ? Math.max(0, Math.min(1, position / duration)) * 100 : 0;
    if (progressFill) progressFill.style.width = `${ratio}%`;
    if (progressNow) progressNow.textContent = fmtTime(position);
    if (progressTotal) progressTotal.textContent = fmtTime(duration);
    if (progressTrack) progressTrack.setAttribute('aria-valuenow', String(Math.round(ratio)));
  }

  function syncPalette(opts: { bg: string; ink: string; accent: string }): void {
    lastPalette = opts;
    if (!pipWindow || pipWindow.closed) return;
    const root = pipWindow.document.documentElement;
    root.style.setProperty('--bg', opts.bg);
    root.style.setProperty('--ink', opts.ink);
    root.style.setProperty('--accent', opts.accent);
  }

  return {
    isSupported: SUPPORTED,
    isOpen: () => Boolean(pipWindow && !pipWindow.closed),
    async toggle() {
      if (!SUPPORTED) return;
      if (pipWindow && !pipWindow.closed) {
        close();
        return;
      }
      const api = (window as PipApiWindow).documentPictureInPicture;
      if (!api) return;
      try {
        const win = await api.requestWindow({ width: 320, height: 420 });
        pipWindow = win;
        win.addEventListener(
          'pagehide',
          () => {
            pipWindow = null;
          },
          { once: true }
        );
        buildDocument(win);
      } catch (err) {
        console.warn('[pip] requestWindow failed', err);
      }
    },
    close,
    syncTrack,
    syncPlayState,
    syncProgress,
    syncPalette
  };
}
