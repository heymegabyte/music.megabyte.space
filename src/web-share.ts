// Web Share API wrapper. Native share-sheet on capable platforms, copy-link fallback.
// Surfaces canShare() feature-detection so callers can show/hide the native button.

export interface SharePayload {
  title: string;
  text: string;
  url: string;
  files?: File[];
}

/** Feature-detect `navigator.share`. Cheap; safe to call from module scope. */
export function nativeShareSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/** Feature-detect file sharing (`navigator.canShare({ files })`). */
export function canShareFiles(): boolean {
  return nativeShareSupported() && typeof navigator.canShare === 'function';
}

/**
 * Trigger the platform share sheet. Resolves to `'cancelled'` on AbortError or
 * any other failure (treating cancel as success so the caller doesn't re-prompt).
 * Returns `'unsupported'` synchronously-shaped when the API is missing.
 */
export async function nativeShare(payload: SharePayload): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!nativeShareSupported()) return 'unsupported';
  const data: ShareData = { title: payload.title, text: payload.text, url: payload.url };
  if (payload.files?.length && canShareFiles() && navigator.canShare({ files: payload.files })) {
    (data as ShareData & { files: File[] }).files = payload.files;
  }
  try {
    await navigator.share(data);
    return 'shared';
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    return 'cancelled';
  }
}

/**
 * Mobile-first share: invoke the native sheet on coarse-pointer devices (touch),
 * otherwise call `fallback` (typically a custom in-page share dialog).
 * If the user cancels the native sheet, do NOT show the fallback — that would
 * feel like the app is harassing them.
 */
export async function shareWithFallback(payload: SharePayload, fallback: () => void): Promise<void> {
  if (nativeShareSupported() && shouldPreferNative()) {
    const result = await nativeShare(payload);
    if (result === 'shared' || result === 'cancelled') return;
  }
  fallback();
}

// Coarse pointer (touch primary) + Share API present = mobile/tablet — prefer the OS sheet.
function shouldPreferNative(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(pointer: coarse)').matches;
}
