// Web Share API wrapper. Native share-sheet on capable platforms, copy-link fallback.
// Surfaces canShare() feature-detection so callers can show/hide the native button.

export interface SharePayload {
  title: string;
  text: string;
  url: string;
  files?: File[];
}

export function nativeShareSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export function canShareFiles(): boolean {
  return nativeShareSupported() && typeof navigator.canShare === 'function';
}

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

// Best for mobile: try native first, fall back to caller-provided fallback (typically opens dialog).
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
