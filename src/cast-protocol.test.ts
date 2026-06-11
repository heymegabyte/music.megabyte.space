import { describe, it, expect } from 'vitest';
import {
  CAST_NAMESPACE,
  CAST_APP_ID,
  CAST_CUSTOM_APP_ID,
  RECEIVER_FALLBACK,
  PROTOCOL_VERSION,
  TICK_HZ,
  SENDER_TICK_HZ,
  STALE_MS,
  MAX_QUEUE
} from './cast-protocol';

// Contract-pin tests (god-tier pattern #10): these constants are load-bearing —
// CAST_APP_ID must match the registered Google Cast receiver and CAST_NAMESPACE
// must match the receiver's message bus, or casting silently connects to the
// wrong app / drops every message. A refactor must NEVER change them by accident;
// changing one here forces a deliberate edit + a receiver re-registration.
describe('cast-protocol constants (load-bearing — must not drift silently)', () => {
  it('pins the custom receiver App ID + its alias', () => {
    expect(CAST_APP_ID).toBe('228565CB');
    expect(CAST_CUSTOM_APP_ID).toBe('228565CB');
    expect(CAST_CUSTOM_APP_ID).toBe(CAST_APP_ID);
    // Google Cast App IDs are 8 uppercase hex chars.
    expect(CAST_APP_ID).toMatch(/^[0-9A-F]{8}$/);
  });

  it('pins the Default Media Receiver fallback (distinct from the custom app)', () => {
    expect(RECEIVER_FALLBACK).toBe('CC1AD845');
    expect(RECEIVER_FALLBACK).not.toBe(CAST_APP_ID);
  });

  it('pins the message-bus namespace (must match the receiver)', () => {
    expect(CAST_NAMESPACE).toBe('urn:x-cast:com.megabyte.music');
    expect(CAST_NAMESPACE.startsWith('urn:x-cast:')).toBe(true);
  });

  it('keeps the heartbeat + liveness timing coherent', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(TICK_HZ).toBeGreaterThan(0);
    expect(SENDER_TICK_HZ).toBeGreaterThan(0);
    // Stale window must outlast at least one sender tick, or liveness flaps.
    expect(STALE_MS).toBeGreaterThan(1000 / SENDER_TICK_HZ);
    expect(MAX_QUEUE).toBeGreaterThanOrEqual(50);
  });
});
