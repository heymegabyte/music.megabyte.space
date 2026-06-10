#!/usr/bin/env node
// Derive the full favicon kit + brand assets from the Ideogram outputs.
// Source: public/brand/logo-b-icon.png (square icon) → 9 favicon assets + maskable + apple-touch.
// Also copies logo-a-lockup.png → public/art/logo-lockup.png and a small chrome-friendly logo-sm.png.

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');
const PUB = resolve(ROOT, 'public');
const ART = resolve(PUB, 'art');
const BRAND = resolve(PUB, 'brand');
await mkdir(ART, { recursive: true });

const ICON_SRC = resolve(BRAND, 'logo-b-icon.png');
const LOCKUP_SRC = resolve(BRAND, 'logo-a-lockup.png');

const SIZES = [
  { file: resolve(PUB, 'favicon-16x16.png'), size: 16 },
  { file: resolve(PUB, 'favicon-32x32.png'), size: 32 },
  { file: resolve(ART, 'icon-16.png'), size: 16 },
  { file: resolve(ART, 'icon-32.png'), size: 32 },
  { file: resolve(ART, 'icon-192.png'), size: 192 },
  { file: resolve(ART, 'icon-256.png'), size: 256 },
  { file: resolve(ART, 'icon-384.png'), size: 384 },
  { file: resolve(ART, 'icon-512.png'), size: 512 },
  { file: resolve(ART, 'icon-maskable-1024.png'), size: 1024 },
  { file: resolve(PUB, 'apple-touch-icon.png'), size: 180 }
];

async function emit(spec) {
  const buf = await sharp(ICON_SRC)
    .resize(spec.size, spec.size, { fit: 'cover', position: 'center' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(spec.file, buf);
  console.log(`[${spec.size}px] ${(buf.length / 1024).toFixed(1)}KB → ${spec.file.replace(ROOT, '.')}`);
}
await Promise.all(SIZES.map(emit));

// favicon.ico — 16+32 multi-resolution. Sharp doesn't write ICO; emit a 32x32 PNG-as-ICO fallback,
// browsers accept this since 2018 (Chrome/Firefox/Safari handle PNG inside .ico container or raw).
const ico32 = await sharp(ICON_SRC).resize(32, 32, { fit: 'cover' }).png().toBuffer();
await writeFile(resolve(PUB, 'favicon.ico'), ico32);
console.log(`[ico] ${(ico32.length / 1024).toFixed(1)}KB → ./public/favicon.ico (PNG-in-ICO container)`);

// Brand lockup → public/art/logo.png (large) + logo-sm.png (small chrome)
const lockup = await readFile(LOCKUP_SRC);
const logoLarge = await sharp(lockup).resize({ width: 1024 }).png({ compressionLevel: 9 }).toBuffer();
await writeFile(resolve(ART, 'logo.png'), logoLarge);
console.log(`[logo.png] ${(logoLarge.length / 1024).toFixed(1)}KB`);

const logoSm = await sharp(lockup).resize({ width: 320 }).png({ compressionLevel: 9 }).toBuffer();
await writeFile(resolve(ART, 'logo-sm.png'), logoSm);
console.log(`[logo-sm.png] ${(logoSm.length / 1024).toFixed(1)}KB`);

// Topbar uses tiny brand mark — derive from icon at 64px for retina @ 32px CSS.
const brandMark = await sharp(ICON_SRC)
  .resize(128, 128, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(resolve(ART, 'brand-mark.png'), brandMark);
console.log(`[brand-mark.png] ${(brandMark.length / 1024).toFixed(1)}KB`);

await copyFile(LOCKUP_SRC, resolve(ART, 'logo-lockup.png'));
console.log(`[logo-lockup.png] copied`);
console.log('\nDone — favicon kit + brand assets regenerated.');
