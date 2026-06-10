#!/usr/bin/env node
/**
 * Process the user-provided bz-icon.png (transparent BG, graffiti bZ) and
 * bz-app-icon.png (dark BG, haloed app icon) into the final asset set:
 *
 *   public/art/bz-icon.png            — trimmed transparent logo for topbar
 *   public/art/bz-app-icon.png        — square app icon master (1024×1024)
 *   public/art/bz-app-icon-{16,32,180,192,256,384,512}.png
 *   public/art/bz-app-icon-maskable-1024.png — 18% interior pad for iOS/Android masks
 *
 * Uses sharp's auto-trim to tighten the transparent logo around the bZ
 * graphic, then derives every favicon/PWA size from the app-icon master.
 */

import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

// 1. Chroma-key the near-white background → transparent, then trim.
//    Source ships as RGB (no alpha) with a near-white #f6f6f6 background.
//    We walk the raw pixel buffer and lift to RGBA where every near-white
//    pixel becomes fully transparent and dark pixels (the graffiti glyph)
//    stay opaque. Edge pixels get a soft alpha gradient so the trimmed
//    logo doesn't show a jagged matte halo against the topbar.
const sourceRaw = await sharp('public/art/bz-icon-source.png')
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { data: srcData, info: srcInfo } = sourceRaw;
const w = srcInfo.width;
const h = srcInfo.height;
const px = Buffer.alloc(w * h * 4);
const HARD_THRESHOLD = 232; // luminance above this → fully transparent
const SOFT_THRESHOLD = 200; // luminance between SOFT..HARD → ramped alpha
for (let i = 0; i < srcData.length; i += 4) {
  const r = srcData[i];
  const g = srcData[i + 1];
  const b = srcData[i + 2];
  const lum = (r + g + b) / 3;
  let alpha;
  if (lum >= HARD_THRESHOLD) {
    alpha = 0;
  } else if (lum >= SOFT_THRESHOLD) {
    // Smooth ramp 0→255 as we cross from HARD back to SOFT
    alpha = Math.round(255 * (1 - (lum - SOFT_THRESHOLD) / (HARD_THRESHOLD - SOFT_THRESHOLD)));
  } else {
    alpha = 255;
  }
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = alpha;
}
const keyed = await sharp(px, { raw: { width: w, height: h, channels: 4 } })
  .png()
  .toBuffer();

// Trim now operates against true transparent edges
const trimmed = await sharp(keyed).trim({ threshold: 5 }).toBuffer();
const { width: tw, height: th } = await sharp(trimmed).metadata();
const padX = Math.round((tw ?? 0) * 0.02);
const padY = Math.round((th ?? 0) * 0.02);
await sharp(trimmed)
  .extend({
    top: padY,
    bottom: padY,
    left: padX,
    right: padX,
    background: { r: 0, g: 0, b: 0, alpha: 0 }
  })
  .png({ compressionLevel: 9, quality: 95 })
  .toFile('public/art/bz-icon.png');
console.log(`✓ bz-icon.png — chroma-keyed white BG, trimmed ${tw}×${th}, padded ${padX}×${padY}`);

// 2. App icon — copy as master 1024 + derive sizes
const appMaster = await sharp('public/art/bz-app-icon-source.png')
  .resize(1024, 1024, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9, quality: 95 })
  .toBuffer();
writeFileSync('public/art/bz-app-icon.png', appMaster);
console.log('✓ bz-app-icon.png (1024 master)');

const FAVICON_SIZES = [16, 32, 96, 180, 192, 256, 384, 512];
for (const size of FAVICON_SIZES) {
  const buf = await sharp(appMaster)
    .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, quality: 95 })
    .toBuffer();
  writeFileSync(`public/art/bz-app-icon-${size}.png`, buf);
  console.log(`  → bz-app-icon-${size}.png`);
}

// 3. Maskable 1024 — 18% interior pad so iOS/Android safe-zone masks
//    don't crop the halo + glyph
const maskableInner = 1024 - 2 * Math.round(1024 * 0.09);
const maskable = await sharp(appMaster)
  .resize(maskableInner, maskableInner, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .extend({
    top: (1024 - maskableInner) / 2,
    bottom: (1024 - maskableInner) / 2,
    left: (1024 - maskableInner) / 2,
    right: (1024 - maskableInner) / 2,
    background: { r: 6, g: 6, b: 16, alpha: 1 }
  })
  .png({ compressionLevel: 9, quality: 95 })
  .toBuffer();
writeFileSync('public/art/bz-app-icon-maskable-1024.png', maskable);
console.log('✓ bz-app-icon-maskable-1024.png');

console.log('\nDone. All bz logo + app icon assets in public/art/.');
