import { afterEach, describe, expect, it, vi } from 'vitest';
import { importVapidJwk, sendPushBatch, type PushSubscriptionRecord } from './web-push';

async function generateVapidJwk(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify'
  ]);
  const publicJwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return { publicJwk, privateJwk };
}

function b64u(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function makeValidSub(host: string, label: string): Promise<PushSubscriptionRecord> {
  // Real P-256 raw public key so the encryption pipeline (ECDH derive) succeeds.
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const rawPub = await crypto.subtle.exportKey('raw', kp.publicKey);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    endpoint: `https://${host}/push/${label}`,
    keys: { p256dh: b64u(rawPub), auth: b64u(auth) }
  };
}

describe('importVapidJwk', () => {
  it('imports a P-256 private JWK for signing', async () => {
    const { privateJwk } = await generateVapidJwk();
    const key = await importVapidJwk(privateJwk, ['sign']);
    expect(key.type).toBe('private');
    expect(key.algorithm).toMatchObject({ name: 'ECDSA', namedCurve: 'P-256' });
    expect(key.usages).toContain('sign');
  });

  it('imports a P-256 public JWK for verifying', async () => {
    const { publicJwk } = await generateVapidJwk();
    const key = await importVapidJwk(publicJwk, ['verify']);
    expect(key.type).toBe('public');
    expect(key.usages).toContain('verify');
  });

  it('marks the imported key as non-extractable', async () => {
    const { privateJwk } = await generateVapidJwk();
    const key = await importVapidJwk(privateJwk, ['sign']);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', key)).rejects.toBeDefined();
  });

  it('rejects an invalid JWK', async () => {
    await expect(importVapidJwk({ kty: 'oct', k: 'AAAA' } as JsonWebKey, ['sign'])).rejects.toBeDefined();
  });
});

describe('sendPushBatch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns one SendResult per subscription, isolating per-endpoint failures', async () => {
    const { privateJwk } = await generateVapidJwk();
    const subs = [await makeValidSub('push.example.com', 'a'), await makeValidSub('push.example.com', 'b')];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const results = await sendPushBatch(subs, 'hello', {
      publicKey: 'irrelevant',
      privateKey: 'irrelevant',
      subject: 'mailto:test@example.com',
      privateJwk
    });

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.ok).toBe(false);
      expect(r.expired).toBe(false);
      expect(r.status).toBe(0);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('marks 410/404 responses as expired', async () => {
    const { privateJwk } = await generateVapidJwk();
    const subs = [await makeValidSub('push.example.com', 'a'), await makeValidSub('push.example.com', 'b')];
    let n = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      n++;
      return new Response(null, { status: n === 1 ? 410 : 404 });
    });

    const results = await sendPushBatch(subs, 'hello', {
      publicKey: 'irrelevant',
      privateKey: 'irrelevant',
      subject: 'mailto:test@example.com',
      privateJwk
    });

    expect(results).toHaveLength(2);
    expect(results[0].expired).toBe(true);
    expect(results[1].expired).toBe(true);
    expect(results.every(r => !r.ok)).toBe(true);
  });

  it('marks 201 as ok and not expired', async () => {
    const { privateJwk } = await generateVapidJwk();
    const subs = [await makeValidSub('push.example.com', 'a')];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 201 }));

    const [r] = await sendPushBatch(subs, 'hello', {
      publicKey: 'irrelevant',
      privateKey: 'irrelevant',
      subject: 'mailto:test@example.com',
      privateJwk
    });
    expect(r.ok).toBe(true);
    expect(r.expired).toBe(false);
    expect(r.status).toBe(201);
  });

  it('returns [] for an empty subscription list without calling fetch', async () => {
    const { privateJwk } = await generateVapidJwk();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const results = await sendPushBatch([], 'hello', {
      publicKey: 'irrelevant',
      privateKey: 'irrelevant',
      subject: 'mailto:test@example.com',
      privateJwk
    });

    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
