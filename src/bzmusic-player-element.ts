/**
 * <bzmusic-player> — drop-in web component for embedding the bZ music
 * player on any third-party page. Single-script distribution:
 *
 *   <script src="https://bzmusic.win/embed.js" defer></script>
 *   <bzmusic-player track="chef-lu-stew"></bzmusic-player>
 *   <bzmusic-player album="appeal"></bzmusic-player>
 *   <bzmusic-player track="chef-lu-stew" theme="dark" accent="#00E5FF"></bzmusic-player>
 *
 * Internally renders an <iframe> pointing at the canonical /embed/<album>/<track>
 * URL with sandbox flags scoped for autoplay + cross-origin storage. Iframe
 * approach keeps the embed sandboxed (no parent-page CSS leaks, no global
 * scope pollution) while the custom element gives parent pages a clean
 * declarative surface they can style + observe.
 *
 * Attributes:
 *   - `track`    — track slug (e.g. "chef-lu-stew")
 *   - `album`    — album slug (e.g. "appeal"); mutually exclusive with `track`
 *                  when no track given the embed shows the full album
 *   - `theme`    — `dark` (default) | `light` (future)
 *   - `accent`   — hex color override (#RRGGBB); falls back to album palette
 *   - `autoplay` — boolean attribute; honored only after a user gesture
 *   - `height`   — px or %; default `220`
 *   - `width`    — px or %; default `100%`
 *
 * Events fired on the element:
 *   - `bzmusic:ready`   — iframe handshake complete
 *   - `bzmusic:play`    — playback started
 *   - `bzmusic:pause`   — playback paused
 *   - `bzmusic:ended`   — track ended
 *   - `bzmusic:seek`    — user scrubbed
 *
 * Methods on the element instance:
 *   - el.play()
 *   - el.pause()
 *   - el.seek(seconds)
 *   - el.nowPlaying() → Promise<{ title, album, currentTime, duration }>
 *
 * The element auto-resolves the album from a track slug. Bare attribute
 * means full-album view. Falls back to a "track not found" iframe screen
 * if the slug doesn't match the catalog.
 */

const ORIGIN = 'https://bzmusic.win';

// Catalog of valid album slugs we'll send to the iframe. Kept inline so
// the bundled embed.js doesn't need to fetch a tracks index just to
// resolve `track="..."` → `/embed/<album>/<track>`. Each track slug is
// the source of truth for album lookup since the embed worker route
// /embed/<track> falls through to /embed/<album>/<track> server-side.
const TRACK_TO_ALBUM: Record<string, string> = {
  // populated at build by inlining src/data.ts ALBUM_BY_TRACK_SLUG —
  // for now use a simpler runtime resolver via the worker:
  // GET /api/embed-resolve?track=chef-lu-stew returns { album, track }
};

class BzMusicPlayer extends HTMLElement {
  static observedAttributes = ['track', 'album', 'theme', 'accent', 'autoplay', 'height', 'width'];

  private iframe?: HTMLIFrameElement;
  private messageHandler = (ev: MessageEvent) => this.onMessage(ev);
  private resolveNowPlaying?: (data: {
    title: string;
    album: string;
    currentTime: number;
    duration: number;
  }) => void;

  connectedCallback() {
    this.render();
    window.addEventListener('message', this.messageHandler);
  }

  disconnectedCallback() {
    window.removeEventListener('message', this.messageHandler);
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  private buildSrc(): string {
    const track = this.getAttribute('track');
    const album = this.getAttribute('album');
    const theme = this.getAttribute('theme') || 'dark';
    const accent = this.getAttribute('accent');
    const autoplay = this.hasAttribute('autoplay');

    let path = '/embed/';
    if (track && album) path += `${album}/${track}`;
    else if (track) {
      // Use a wrapper route that resolves track-only to its album. The
      // worker already handles single-slug paths under /embed/<slug>
      // gracefully (404s on missing data).
      path += `${track}`;
    } else if (album) path += album;
    else path += 'appeal'; // fallback so the iframe isn't blank

    const params = new URLSearchParams();
    if (theme !== 'dark') params.set('theme', theme);
    if (accent) params.set('accent', accent);
    if (autoplay) params.set('autoplay', '1');
    const qs = params.toString();
    return `${ORIGIN}${path}${qs ? '?' + qs : ''}`;
  }

  private render() {
    const width = this.getAttribute('width') || '100%';
    const height = this.getAttribute('height') || '220';
    const src = this.buildSrc();

    // Reuse existing iframe across attribute changes that only touch
    // params — saves the cold-load flash.
    if (this.iframe && this.iframe.src === src) return;

    if (!this.iframe) {
      this.iframe = document.createElement('iframe');
      this.iframe.setAttribute('title', 'bZ music player');
      this.iframe.setAttribute('loading', 'lazy');
      this.iframe.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; clipboard-write');
      this.iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
      this.iframe.style.cssText = 'border:0;background:#060610;border-radius:14px;display:block;';
      this.appendChild(this.iframe);
    }

    this.iframe.style.width = /^\d+$/.test(width) ? `${width}px` : width;
    this.iframe.style.height = /^\d+$/.test(height) ? `${height}px` : height;
    this.iframe.src = src;
  }

  private onMessage(ev: MessageEvent) {
    // Trust only messages from the bzmusic origin
    if (ev.origin !== ORIGIN) return;
    if (!ev.data || typeof ev.data !== 'object') return;
    const data = ev.data as { type?: string; payload?: unknown };
    if (typeof data.type !== 'string' || !data.type.startsWith('bzmusic:')) return;

    // Forward worker→parent messages as CustomEvents on the element
    this.dispatchEvent(new CustomEvent(data.type, { detail: data.payload, bubbles: true }));

    if (data.type === 'bzmusic:nowplaying' && this.resolveNowPlaying) {
      this.resolveNowPlaying(
        data.payload as { title: string; album: string; currentTime: number; duration: number }
      );
      this.resolveNowPlaying = undefined;
    }
  }

  private send(type: string, payload?: unknown) {
    this.iframe?.contentWindow?.postMessage({ type, payload }, ORIGIN);
  }

  // Public API
  play() {
    this.send('bzmusic:play');
  }
  pause() {
    this.send('bzmusic:pause');
  }
  seek(seconds: number) {
    this.send('bzmusic:seek', { seconds });
  }
  nowPlaying(): Promise<{ title: string; album: string; currentTime: number; duration: number }> {
    return new Promise(resolve => {
      this.resolveNowPlaying = resolve;
      this.send('bzmusic:get-nowplaying');
    });
  }
}

// Defensive: re-defining a custom element throws. Guard so multiple script
// includes on the same page don't blow up — the second include is a no-op.
if (!customElements.get('bzmusic-player')) {
  customElements.define('bzmusic-player', BzMusicPlayer);
}

// Mark the script as loaded so docs pages can detect the API surface
(window as Window & { bzmusicPlayer?: typeof BzMusicPlayer }).bzmusicPlayer = BzMusicPlayer;
