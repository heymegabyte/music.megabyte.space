#!/usr/bin/env node
// Derive the full favicon kit + brand assets from the spray-paint master.
// Source: public/brand/logo-spray.png (1024×1024 RGB on solid black).
// Outputs:
//   public/favicon.ico (multi-res via ImageMagick)
//   public/favicon-16x16.png, favicon-32x32.png
//   public/apple-touch-icon.png (180×180, flattened over #060610 — iOS strips alpha)
//   public/icon-192.png, icon-256.png, icon-384.png, icon-512.png (PNG, retain background)
//   public/icon-maskable-1024.png (1024×1024, scaled to 70% center, padded #060610 — Android safe-zone)
//   public/art/brand-mark.png (128×128 — topbar mark)
//   public/art/logo.png (1024×1024 master)
//   public/art/logo-sm.png (320 wide — low-DPI placements)

import { writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const ROOT = resolve(import.meta.dirname, '..');
const PUB = resolve(ROOT, 'public');
const ART = resolve(PUB, 'art');
const BRAND = resolve(PUB, 'brand');
await mkdir(ART, { recursive: true });

const SRC = resolve(BRAND, 'logo-spray.png');
const BG = '#060610';
const MAGICK = '/opt/homebrew/bin/magick';

// 1) Standard PWA + favicon PNG sizes — keep source bg (already #000-ish), preserve PNG.
const PNG_TARGETS = [
  { file: resolve(PUB, 'favicon-16x16.png'), size: 16 },
  { file: resolve(PUB, 'favicon-32x32.png'), size: 32 },
  { file: resolve(PUB, 'icon-192.png'), size: 192 },
  { file: resolve(PUB, 'icon-256.png'), size: 256 },
  { file: resolve(PUB, 'icon-384.png'), size: 384 },
  { file: resolve(PUB, 'icon-512.png'), size: 512 }
];
for (const t of PNG_TARGETS) {
  const buf = await sharp(SRC)
    .resize(t.size, t.size, { fit: 'cover', position: 'center' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(t.file, buf);
  console.log(`[${t.size}px] ${(buf.length / 1024).toFixed(1)}KB → ${t.file.replace(ROOT, '.')}`);
}

// 2) apple-touch-icon — 180×180, MUST be flattened (iOS strips alpha → black bars otherwise).
const apple = await sharp(SRC)
  .resize(180, 180, { fit: 'cover', position: 'center' })
  .flatten({ background: BG })
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(resolve(PUB, 'apple-touch-icon.png'), apple);
console.log(`[apple-touch 180px] ${(apple.length / 1024).toFixed(1)}KB → ./public/apple-touch-icon.png`);

// 3) icon-maskable-1024 — Android maskable spec: keep ~70% center safe zone, pad with #060610.
//    Render the spray tag at 70% of 1024 (≈716px) on a 1024 #060610 canvas, centered.
const maskCenter = await sharp(SRC).resize(716, 716, { fit: 'contain', background: BG }).png().toBuffer();
const maskable = await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: BG }
})
  .composite([{ input: maskCenter, gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(resolve(PUB, 'icon-maskable-1024.png'), maskable);
console.log(`[maskable 1024px] ${(maskable.length / 1024).toFixed(1)}KB → ./public/icon-maskable-1024.png`);

// 4) favicon.ico — multi-res 16/32/48 via ImageMagick (sharp can't write ICO containers).
const icoOut = resolve(PUB, 'favicon.ico');
await execFileAsync(MAGICK, [SRC, '-resize', '256x256', '-define', 'icon:auto-resize=16,32,48', icoOut]);
const icoStat = await stat(icoOut);
console.log(`[ico multi-res 16/32/48] ${(icoStat.size / 1024).toFixed(1)}KB → ./public/favicon.ico`);

// 5) Brand assets in public/art/
const logoMaster = await sharp(SRC)
  .resize(1024, 1024, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(resolve(ART, 'logo.png'), logoMaster);
console.log(`[logo.png 1024×1024] ${(logoMaster.length / 1024).toFixed(1)}KB → ./public/art/logo.png`);

const logoSm = await sharp(SRC).resize(320, 320, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer();
await writeFile(resolve(ART, 'logo-sm.png'), logoSm);
console.log(`[logo-sm.png 320×320] ${(logoSm.length / 1024).toFixed(1)}KB → ./public/art/logo-sm.png`);

const brandMark = await sharp(SRC).resize(128, 128, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer();
await writeFile(resolve(ART, 'brand-mark.png'), brandMark);
console.log(
  `[brand-mark.png 128×128] ${(brandMark.length / 1024).toFixed(1)}KB → ./public/art/brand-mark.png`
);

// 6) Mirror PWA icons into /art/ for backward compat with site.webmanifest paths if needed.
for (const size of [192, 256, 384, 512]) {
  const buf = await sharp(SRC).resize(size, size, { fit: 'cover' }).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(resolve(ART, `icon-${size}.png`), buf);
  console.log(`[art/icon-${size}.png] ${(buf.length / 1024).toFixed(1)}KB`);
}
const maskArt = await sharp(SRC).resize(716, 716, { fit: 'contain', background: BG }).toBuffer();
const maskableArt = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: BG } })
  .composite([{ input: maskArt, gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(resolve(ART, 'icon-maskable-1024.png'), maskableArt);
console.log(`[art/icon-maskable-1024.png] ${(maskableArt.length / 1024).toFixed(1)}KB`);

console.log('\nDone — spray-paint favicon kit + brand assets generated.');
