// Spotify Connect pairing surface.
//
// Why this exists: bZ's catalog is being distributed to Spotify via DistroKid
// (see src/integrations.ts). Once the artist is live, users will be able to
// pair their Spotify account and push the currently-playing track to any
// Spotify Connect device on their network (HomePod, Sonos, Echo, car).
//
// Auth flow: PKCE (RFC 7636) — verifier in sessionStorage, no server secret.
// Token in localStorage (`spotify:token`) with expiry; refresh on demand via
// `refresh_token`. Gracefully no-ops if SPOTIFY_CLIENT_ID is empty so the
// pairing CTA still renders (with a "coming soon" badge) and the dialog
// itself remains demoable.
//
// Endpoints used (https://developer.spotify.com/documentation/web-api):
//   POST https://accounts.spotify.com/api/token        — token exchange
//   GET  https://api.spotify.com/v1/me                 — paired account info
//   GET  https://api.spotify.com/v1/me/player/devices  — list Connect devices
//   PUT  https://api.spotify.com/v1/me/player          — transfer playback

import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI } from './data';

interface SpotifyToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type: string;
  scope: string;
}

interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  volume_percent: number | null;
}

const TOKEN_KEY = 'spotify:token';
const VERIFIER_KEY = 'spotify:verifier';
const STATE_KEY = 'spotify:state';
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'streaming'
].join(' ');

function base64UrlEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
}

function randomString(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return base64UrlEncode(a.buffer);
}

function getToken(): SpotifyToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as SpotifyToken;
    if (!t.access_token || !t.expires_at) return null;
    return t;
  } catch {
    return null;
  }
}

function setToken(t: SpotifyToken | null) {
  if (!t) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}

function isExpired(t: SpotifyToken): boolean {
  return Date.now() >= t.expires_at - 30_000;
}

export function isConfigured(): boolean {
  return !!SPOTIFY_CLIENT_ID;
}
export function isPaired(): boolean {
  return !!getToken();
}

/** Build the Spotify authorize URL with PKCE challenge, then redirect. */
export async function startPairing(): Promise<void> {
  if (!SPOTIFY_CLIENT_ID) throw new Error('SPOTIFY_CLIENT_ID is not configured');
  const verifier = randomString(64);
  const challenge = base64UrlEncode(await sha256(verifier));
  const state = randomString(16);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: SPOTIFY_REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SCOPES
  });
  window.location.assign(`https://accounts.spotify.com/authorize?${params.toString()}`);
}

/** Exchange the OAuth code for a token. Called from /spotify/callback. */
export async function completePairing(code: string, state: string): Promise<SpotifyToken> {
  if (!SPOTIFY_CLIENT_ID) throw new Error('SPOTIFY_CLIENT_ID is not configured');
  const expectedState = sessionStorage.getItem(STATE_KEY);
  if (!expectedState || expectedState !== state) throw new Error('state mismatch');
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) throw new Error('verifier missing');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: SPOTIFY_CLIENT_ID,
    code_verifier: verifier
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };
  const token: SpotifyToken = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    token_type: json.token_type,
    scope: json.scope
  };
  setToken(token);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return token;
}

async function refreshIfNeeded(): Promise<SpotifyToken | null> {
  const t = getToken();
  if (!t) return null;
  if (!isExpired(t)) return t;
  if (!t.refresh_token || !SPOTIFY_CLIENT_ID) {
    setToken(null);
    return null;
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: t.refresh_token,
    client_id: SPOTIFY_CLIENT_ID
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) {
    setToken(null);
    return null;
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };
  const updated: SpotifyToken = {
    access_token: json.access_token,
    refresh_token: json.refresh_token || t.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
    token_type: json.token_type,
    scope: json.scope || t.scope
  };
  setToken(updated);
  return updated;
}

export function unpair(): void {
  setToken(null);
}

async function authFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const t = await refreshIfNeeded();
  if (!t) throw new Error('not paired');
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${t.access_token}` }
  });
  if (res.status === 401) {
    setToken(null);
    throw new Error('unauthorized');
  }
  if (!res.ok && res.status !== 204) throw new Error(`spotify ${res.status}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function listDevices(): Promise<SpotifyDevice[]> {
  const body = await authFetch<{ devices: SpotifyDevice[] }>('/me/player/devices');
  return body.devices || [];
}

export async function getAccount(): Promise<{
  id: string;
  display_name: string;
  product: string;
  email?: string;
}> {
  return authFetch('/me');
}

export async function transferPlayback(deviceId: string, play = true): Promise<void> {
  await authFetch('/me/player', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_ids: [deviceId], play })
  });
}

/** Render the pairing CTA + modal into the more-menu. Idempotent — safe to
 * call multiple times. */
export function mountSpotifyConnect(menuRoot: HTMLElement): void {
  if (menuRoot.querySelector('[data-action="spotify-pair"]')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'more-menu__item';
  btn.setAttribute('data-action', 'spotify-pair');
  btn.setAttribute('role', 'menuitem');
  btn.innerHTML = `
    <svg role="img" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
    <span id="spotifyPairLabel">${isPaired() ? 'Spotify Connect — paired' : 'Pair Spotify Connect'}</span>
    ${!isConfigured() ? '<span class="more-menu__dot" aria-hidden="true" style="background:#1db954"></span>' : ''}
  `;
  btn.addEventListener('click', () => openSpotifyDialog());
  menuRoot.appendChild(btn);
}

function ensureDialog(): HTMLDialogElement {
  let dlg = document.getElementById('spotifyDialog') as HTMLDialogElement | null;
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = 'spotifyDialog';
  dlg.className = 'spotify-dialog';
  dlg.setAttribute('aria-labelledby', 'spotifyDialogTitle');
  dlg.innerHTML = `
    <form method="dialog" class="spotify-dialog__close-form">
      <button class="spotify-dialog__close" type="submit" aria-label="Close">✕</button>
    </form>
    <div class="spotify-dialog__head">
      <svg role="img" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" fill="#1db954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
      <h3 id="spotifyDialogTitle">Spotify Connect</h3>
    </div>
    <div class="spotify-dialog__body" id="spotifyDialogBody"></div>
  `;
  document.body.appendChild(dlg);
  return dlg;
}

async function renderDialogBody(): Promise<void> {
  const body = document.getElementById('spotifyDialogBody');
  if (!body) return;
  if (!isConfigured()) {
    body.innerHTML = `
      <p class="spotify-dialog__lede">bZ's catalog is being distributed to Spotify via DistroKid. Once live, pair your account to push tracks from this site to any Spotify Connect device on your network — HomePod, Sonos, Echo, car stereo, the works.</p>
      <p class="spotify-dialog__hint">Pairing requires a Spotify developer client ID. The pairing surface is wired and ready — when <code>SPOTIFY_CLIENT_ID</code> is set in <code>src/data.ts</code>, this button will initiate the OAuth flow.</p>
      <button type="button" class="spotify-dialog__cta is-disabled" disabled>Pairing coming soon</button>
    `;
    return;
  }
  if (!isPaired()) {
    body.innerHTML = `
      <p class="spotify-dialog__lede">Pair your Spotify account to push tracks from this site to any Spotify Connect device — HomePod, Sonos, Echo, car stereo.</p>
      <p class="spotify-dialog__hint">You'll be redirected to Spotify to authorize. We never see your password.</p>
      <button type="button" class="spotify-dialog__cta" id="spotifyPairBtn">Pair with Spotify</button>
    `;
    document.getElementById('spotifyPairBtn')?.addEventListener('click', () => {
      startPairing().catch(err => {
        console.error('[spotify] pair failed', err);
      });
    });
    return;
  }
  body.innerHTML = `
    <p class="spotify-dialog__lede">Paired with Spotify. Choose a device to transfer playback.</p>
    <div class="spotify-dialog__devices" id="spotifyDevicesList" role="list" aria-busy="true">Loading devices…</div>
    <button type="button" class="spotify-dialog__cta spotify-dialog__cta--ghost" id="spotifyUnpairBtn">Unpair</button>
  `;
  document.getElementById('spotifyUnpairBtn')?.addEventListener('click', () => {
    unpair();
    renderDialogBody();
  });
  try {
    const devices = await listDevices();
    const list = document.getElementById('spotifyDevicesList');
    if (!list) return;
    list.removeAttribute('aria-busy');
    if (devices.length === 0) {
      list.innerHTML =
        '<p class="spotify-dialog__hint">No Spotify Connect devices found. Open Spotify on a device, then refresh.</p>';
      return;
    }
    list.innerHTML = devices
      .map(
        d => `
      <button type="button" class="spotify-device${d.is_active ? ' is-active' : ''}" data-device="${d.id}" role="listitem">
        <span class="spotify-device__name">${d.name}</span>
        <span class="spotify-device__type">${d.type}${d.is_active ? ' · active' : ''}</span>
      </button>
    `
      )
      .join('');
    list.querySelectorAll<HTMLButtonElement>('.spotify-device').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-device');
        if (!id) return;
        btn.classList.add('is-loading');
        try {
          await transferPlayback(id, true);
          renderDialogBody();
        } catch (err) {
          console.error('[spotify] transfer failed', err);
          btn.classList.remove('is-loading');
        }
      });
    });
  } catch (err) {
    const list = document.getElementById('spotifyDevicesList');
    if (list)
      list.innerHTML = `<p class="spotify-dialog__hint">Couldn't load devices: ${(err as Error).message}. Try unpairing and re-pairing.</p>`;
  }
}

export function openSpotifyDialog(): void {
  const dlg = ensureDialog();
  renderDialogBody();
  if (!dlg.open) dlg.showModal();
}

/** Process /spotify/callback URLs on page load. Worker rewrites the path
 * to `/` and forwards `?code=...&state=...` query params; we read them
 * here, exchange for a token, and clean the URL. */
export async function handleAuthCallback(): Promise<void> {
  if (!window.location.pathname.startsWith('/spotify/callback')) return;
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return;
  try {
    await completePairing(code, state);
  } catch (err) {
    console.error('[spotify] pairing callback failed', err);
  } finally {
    window.history.replaceState(null, '', '/');
    openSpotifyDialog();
  }
}
