// AirPlay (Safari/macOS), Wake Lock (lyrics-fullscreen / karaoke),
// Picture-in-Picture (cover-as-video), Odesli/song.link smart links,
// Service Worker MediaSession action proxies. All optional, all fail-safe.

interface AirPlayElement extends HTMLAudioElement {
  webkitShowPlaybackTargetPicker?: () => void;
}

interface AirPlayEvent extends Event {
  availability?: 'available' | 'not-available';
}

const ODESLI_BASE = 'https://api.song.link/v1-alpha.1/links';

let wakeLock: WakeLockSentinel | null = null;
let wakeLockReacquireBound = false;

export function airplayAvailable(audioEl: HTMLAudioElement): Promise<boolean> {
  return new Promise(resolve => {
    const el = audioEl as AirPlayElement;
    if (typeof el.webkitShowPlaybackTargetPicker !== 'function') {
      resolve(false);
      return;
    }
    let settled = false;
    const onAvail = (ev: AirPlayEvent) => {
      if (settled) return;
      settled = true;
      el.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvail as EventListener);
      resolve(ev.availability === 'available');
    };
    el.addEventListener('webkitplaybacktargetavailabilitychanged', onAvail as EventListener);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      el.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvail as EventListener);
      resolve(typeof el.webkitShowPlaybackTargetPicker === 'function');
    }, 600);
  });
}

export function showAirPlayPicker(audioEl: HTMLAudioElement): void {
  const el = audioEl as AirPlayElement;
  el.webkitShowPlaybackTargetPicker?.();
}

export async function acquireWakeLock(): Promise<boolean> {
  if (!('wakeLock' in navigator)) return false;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
    if (!wakeLockReacquireBound) {
      wakeLockReacquireBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !wakeLock) acquireWakeLock();
      });
    }
    return true;
  } catch {
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLock?.release();
  } catch { /* noop */ }
  wakeLock = null;
}

export function pipSupported(): boolean {
  return 'pictureInPictureEnabled' in document && (document as Document & { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true;
}

export async function requestPip(videoEl: HTMLVideoElement): Promise<boolean> {
  if (!pipSupported()) return false;
  try {
    await videoEl.requestPictureInPicture();
    return true;
  } catch {
    return false;
  }
}

export async function exitPip(): Promise<void> {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
  } catch { /* noop */ }
}

interface OdesliLink {
  url: string;
  nativeAppUriMobile?: string;
  nativeAppUriDesktop?: string;
}
export interface OdesliResponse {
  pageUrl: string;
  linksByPlatform: Record<string, OdesliLink>;
}

export async function fetchOdesliLinks(trackUrl: string, signal?: AbortSignal): Promise<OdesliResponse | null> {
  try {
    const res = await fetch(`${ODESLI_BASE}?url=${encodeURIComponent(trackUrl)}&userCountry=US`, {
      cache: 'force-cache',
      signal
    });
    if (!res.ok) return null;
    return await res.json() as OdesliResponse;
  } catch {
    return null;
  }
}

export function openSmartLink(trackUrl: string): void {
  const target = `https://song.link/${encodeURIComponent(trackUrl)}`;
  window.open(target, '_blank', 'noopener');
}

export function setMediaSessionPosition(audio: HTMLAudioElement): void {
  if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;
  const duration = isFinite(audio.duration) ? audio.duration : 0;
  if (duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime, duration)
    });
  } catch { /* noop — Safari throws on bad inputs */ }
}

export function setMediaSessionPlaybackState(playing: boolean): void {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  } catch { /* noop */ }
}

type OrientationLock = 'any' | 'natural' | 'landscape' | 'portrait' | 'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary';

export function bindOrientationLock(orientation: OrientationLock): () => void {
  const screenObj = screen as Screen & { orientation?: ScreenOrientation & { lock?: (o: OrientationLock) => Promise<void> } };
  const lock = screenObj.orientation?.lock;
  if (typeof lock === 'function') {
    lock.call(screenObj.orientation, orientation).catch(() => { /* user gesture required, ignore */ });
  }
  return () => {
    try { screenObj.orientation?.unlock?.(); } catch { /* noop */ }
  };
}
