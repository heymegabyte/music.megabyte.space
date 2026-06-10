import { afterEach, describe, it, expect, vi } from 'vitest';
import { nativeShareSupported, canShareFiles, nativeShare, shareWithFallback } from './web-share';

const restore: Array<() => void> = [];

function stubNavigator(value: unknown) {
  const original = (globalThis as { navigator?: Navigator }).navigator;
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true
  });
  restore.push(() => {
    if (original === undefined) delete (globalThis as { navigator?: unknown }).navigator;
    else
      Object.defineProperty(globalThis, 'navigator', {
        value: original,
        configurable: true,
        writable: true
      });
  });
}

function stubMatchMedia(matches: boolean) {
  const original = (globalThis as { matchMedia?: typeof matchMedia }).matchMedia;
  (globalThis as { matchMedia?: unknown }).matchMedia = vi.fn(() => ({
    matches,
    media: '(pointer: coarse)',
    addEventListener: () => {},
    removeEventListener: () => {}
  }));
  restore.push(() => {
    if (original === undefined) delete (globalThis as { matchMedia?: unknown }).matchMedia;
    else (globalThis as { matchMedia?: unknown }).matchMedia = original;
  });
}

afterEach(() => {
  while (restore.length) restore.pop()!();
});

describe('nativeShareSupported', () => {
  it('returns false when navigator is missing', () => {
    stubNavigator(undefined);
    expect(nativeShareSupported()).toBe(false);
  });

  it('returns false when navigator.share is missing', () => {
    stubNavigator({});
    expect(nativeShareSupported()).toBe(false);
  });

  it('returns true when navigator.share is a function', () => {
    stubNavigator({ share: () => Promise.resolve() });
    expect(nativeShareSupported()).toBe(true);
  });
});

describe('canShareFiles', () => {
  it('requires both navigator.share and navigator.canShare', () => {
    stubNavigator({ share: () => Promise.resolve() });
    expect(canShareFiles()).toBe(false);
  });

  it('returns true when both are present', () => {
    stubNavigator({ share: () => Promise.resolve(), canShare: () => true });
    expect(canShareFiles()).toBe(true);
  });
});

describe('nativeShare', () => {
  const payload = { title: 't', text: 'x', url: 'https://example.com' };

  it('returns "unsupported" when navigator.share is missing', async () => {
    stubNavigator({});
    expect(await nativeShare(payload)).toBe('unsupported');
  });

  it('returns "shared" on successful share', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    expect(await nativeShare(payload)).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 't', text: 'x', url: 'https://example.com' });
  });

  it('returns "cancelled" on AbortError (user dismiss)', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new DOMException('cancelled', 'AbortError')));
    stubNavigator({ share });
    expect(await nativeShare(payload)).toBe('cancelled');
  });

  it('returns "cancelled" on any non-Abort error (treat as user-dismiss to avoid double-prompt)', async () => {
    const share = vi.fn().mockRejectedValue(new TypeError('boom'));
    stubNavigator({ share });
    expect(await nativeShare(payload)).toBe('cancelled');
  });

  it('attaches files only when canShare confirms support', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    stubNavigator({ share, canShare });
    const file = new File(['hi'], 'a.txt');
    await nativeShare({ ...payload, files: [file] });
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [file], title: 't', text: 'x' }));
  });

  it('omits files when canShare returns false', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(false);
    stubNavigator({ share, canShare });
    await nativeShare({ ...payload, files: [new File(['hi'], 'a.txt')] });
    expect(share).toHaveBeenCalledWith({ title: 't', text: 'x', url: 'https://example.com' });
  });
});

describe('shareWithFallback', () => {
  const payload = { title: 't', text: 'x', url: 'https://example.com' };

  it('falls back when native share is unsupported', async () => {
    stubNavigator({});
    const fallback = vi.fn();
    await shareWithFallback(payload, fallback);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('falls back on desktop (fine pointer) even when share is supported', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    stubMatchMedia(false);
    const fallback = vi.fn();
    await shareWithFallback(payload, fallback);
    expect(share).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('uses native sheet on touch devices and does NOT call fallback on cancel', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new DOMException('cancelled', 'AbortError')));
    stubNavigator({ share });
    stubMatchMedia(true);
    const fallback = vi.fn();
    await shareWithFallback(payload, fallback);
    expect(share).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses native sheet on touch devices and does NOT call fallback on success', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubNavigator({ share });
    stubMatchMedia(true);
    const fallback = vi.fn();
    await shareWithFallback(payload, fallback);
    expect(share).toHaveBeenCalledOnce();
    expect(fallback).not.toHaveBeenCalled();
  });
});
