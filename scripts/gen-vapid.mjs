#!/usr/bin/env node
// Generate a VAPID P-256 keypair for Web Push.
// Outputs:
//   - VAPID_PUBLIC_KEY  (base64url, 65-byte raw P-256, uncompressed)
//   - VAPID_PRIVATE_JWK (JSON, kty=EC, crv=P-256, with d/x/y)
// Plus copy-pasteable wrangler secret commands for the Worker.

import { webcrypto as crypto } from 'node:crypto';

function b64u(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return Buffer.from(s, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const jwkPriv = await crypto.subtle.exportKey('jwk', kp.privateKey);

const VAPID_PUBLIC_KEY = b64u(rawPub);
const VAPID_PRIVATE_JWK = JSON.stringify({
  kty: jwkPriv.kty,
  crv: jwkPriv.crv,
  d: jwkPriv.d,
  x: jwkPriv.x,
  y: jwkPriv.y
});

console.log('# VAPID keypair — keep VAPID_PRIVATE_JWK secret');
console.log('');
console.log(`VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY}`);
console.log(`VAPID_PRIVATE_JWK=${VAPID_PRIVATE_JWK}`);
console.log('');
console.log('# Wrangler secrets (production):');
console.log(`echo -n '${VAPID_PUBLIC_KEY}' | wrangler secret put VAPID_PUBLIC_KEY`);
console.log(`echo -n '${VAPID_PRIVATE_JWK}' | wrangler secret put VAPID_PRIVATE_JWK`);
console.log(`echo -n 'mailto:brian@megabyte.space' | wrangler secret put VAPID_SUBJECT`);
console.log('# Admin token to broadcast pushes via POST /api/push/send:');
console.log(`echo -n "$(openssl rand -hex 32)" | wrangler secret put PUSH_ADMIN_TOKEN`);
