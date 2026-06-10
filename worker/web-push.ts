// VAPID + RFC 8291 (aes128gcm) Web Push, pure Web Crypto. No Node deps.
// Sign JWT (ES256) for VAPID auth, encrypt payload for receiver, send to push service.

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface VapidConfig {
  publicKey: string; // base64url, raw P-256 65 bytes (0x04 || X(32) || Y(32))
  privateKey: string; // base64url, raw 32-byte d
  subject: string; // mailto:... or https://...
}

type Bytes = Uint8Array<ArrayBuffer>;

function asBytes(n: number): Bytes {
  return new Uint8Array(new ArrayBuffer(n)) as Bytes;
}

function fromArray(arr: ArrayLike<number>): Bytes {
  const out = asBytes(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i];
  return out;
}

function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64uDecode(s: string): Bytes {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = asBytes(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function concat(...parts: Bytes[]): Bytes {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = asBytes(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function encodeUtf8(s: string): Bytes {
  const enc = new TextEncoder().encode(s);
  // TextEncoder.encode returns Uint8Array<ArrayBuffer> in Workers runtime; copy to be safe.
  const out = asBytes(enc.length);
  out.set(enc);
  return out;
}

/**
 * Import a VAPID JWK (P-256) for ES256 signing/verifying. The key is marked
 * non-extractable so it can't leak via export — callers should pass the JWK
 * from a Worker secret, not from request bodies.
 */
export async function importVapidJwk(jwk: JsonWebKey, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, usage);
}

async function importEcdhPublic(rawP256: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawP256, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

async function exportRawPublic(key: CryptoKey): Promise<Bytes> {
  const buf = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(buf) as Bytes;
}

async function hmacSha256(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, data);
  return new Uint8Array(sig) as Bytes;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const prk = await hmacSha256(salt, ikm);
  // RFC 5869 expand — single-block T(1) suffices for length<=32.
  const t1 = await hmacSha256(prk, concat(info, fromArray([0x01])));
  return t1.slice(0, length) as Bytes;
}

async function signVapidJwt(privateJwk: JsonWebKey, audience: string, subject: string): Promise<string> {
  const header = { alg: 'ES256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const payload = { aud: audience, exp, sub: subject };
  const headerB64 = b64uEncode(encodeUtf8(JSON.stringify(header)));
  const payloadB64 = b64uEncode(encodeUtf8(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encodeUtf8(signingInput));
  return `${signingInput}.${b64uEncode(sigBuf)}`;
}

interface EncryptResult {
  body: Bytes;
}

async function encryptAes128Gcm(
  payload: Bytes,
  clientP256dh: Bytes,
  clientAuth: Bytes
): Promise<EncryptResult> {
  // RFC 8291 §3 + RFC 8188 (aes128gcm content-encoding).
  const recordSize = 4096;
  const salt = crypto.getRandomValues(asBytes(16));

  // Ephemeral server ECDH keypair
  const serverKp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits'
  ]);
  const serverPubRaw = await exportRawPublic(serverKp.publicKey);
  const clientPubKey = await importEcdhPublic(clientP256dh);
  const ecdhSecretBuf = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPubKey },
    serverKp.privateKey,
    256
  );
  const ecdhSecret = new Uint8Array(ecdhSecretBuf) as Bytes;

  // Step 1: PRK_key = HKDF-Extract(auth, ECDH) → 32B PRK; key_info = "WebPush: info\0" || ua_pub || as_pub
  const keyInfo = concat(encodeUtf8('WebPush: info\0'), clientP256dh, serverPubRaw);
  const ikm = await hkdf(clientAuth, ecdhSecret, concat(keyInfo, fromArray([0x01])), 32);

  // Step 2: CEK = HKDF(salt, ikm, "Content-Encoding: aes128gcm\0", 16)
  const cek = await hkdf(
    salt,
    ikm,
    concat(encodeUtf8('Content-Encoding: aes128gcm\0'), fromArray([0x01])),
    16
  );
  // Step 3: nonce = HKDF(salt, ikm, "Content-Encoding: nonce\0", 12)
  const nonce = await hkdf(salt, ikm, concat(encodeUtf8('Content-Encoding: nonce\0'), fromArray([0x01])), 12);

  // Plaintext padding: payload || 0x02 (single record, last record marker = 0x02)
  const plaintext = concat(payload, fromArray([0x02]));

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ctBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    cekKey,
    plaintext
  );
  const ciphertext = new Uint8Array(ctBuf) as Bytes;

  // Header: salt(16) || rs(4 BE) || idlen(1) || keyid(serverPubRaw)
  const header = asBytes(16 + 4 + 1 + serverPubRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize, false);
  header[20] = serverPubRaw.length;
  header.set(serverPubRaw, 21);

  return { body: concat(header, ciphertext) };
}

export interface SendOptions {
  ttl?: number;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  topic?: string;
}

export interface SendResult {
  endpoint: string;
  status: number;
  ok: boolean;
  expired: boolean;
}

/**
 * Send a single push notification. Returns expired=true on 404/410 so caller can prune.
 */
export async function sendPush(
  sub: PushSubscriptionRecord,
  payload: Bytes | string,
  vapid: VapidConfig & { privateJwk: JsonWebKey },
  opts: SendOptions = {}
): Promise<SendResult> {
  const url = new URL(sub.endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await signVapidJwt(vapid.privateJwk, audience, vapid.subject);

  const body = typeof payload === 'string' ? encodeUtf8(payload) : payload;
  const enc = await encryptAes128Gcm(body, b64uDecode(sub.keys.p256dh), b64uDecode(sub.keys.auth));

  const headers: Record<string, string> = {
    Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(opts.ttl ?? 86400),
    Urgency: opts.urgency ?? 'normal'
  };
  if (opts.topic) headers['Topic'] = opts.topic;

  const res = await fetch(sub.endpoint, { method: 'POST', headers, body: enc.body });
  const expired = res.status === 404 || res.status === 410;
  return { endpoint: sub.endpoint, status: res.status, ok: res.ok, expired };
}

/**
 * Send the same payload to many subscriptions in parallel. Failures are
 * isolated per-endpoint: a network error on one sub still returns a
 * `SendResult` so the caller can iterate and prune by `expired`/`!ok`.
 */
export async function sendPushBatch(
  subs: PushSubscriptionRecord[],
  payload: Bytes | string,
  vapid: VapidConfig & { privateJwk: JsonWebKey },
  opts: SendOptions = {}
): Promise<SendResult[]> {
  return Promise.all(
    subs.map(s =>
      sendPush(s, payload, vapid, opts).catch(
        err =>
          ({
            endpoint: s.endpoint,
            status: 0,
            ok: false,
            expired: false,
            error: err instanceof Error ? err.message : String(err)
          }) as SendResult
      )
    )
  );
}
