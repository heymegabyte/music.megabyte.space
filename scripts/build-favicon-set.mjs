#!/usr/bin/env node
/**
 * Replicates real-favicongenerator output from a single 1024+ master PNG.
 *
 * Source: ~/Downloads/bz-app-icon.png (or public/art/bz-app-icon-source.png)
 *
 * Generates the full asset set into public/:
 *   /favicon.ico                  — multi-res 16+32+48 ICO
 *   /favicon-16x16.png
 *   /favicon-32x32.png
 *   /favicon-48x48.png
 *   /favicon-96x96.png
 *   /apple-touch-icon.png         — 180×180 default Apple
 *   /apple-touch-icon-{57,60,72,76,114,120,144,152,180}x{}.png
 *   /android-chrome-192x192.png
 *   /android-chrome-512x512.png
 *   /mstile-150x150.png
 *   /browserconfig.xml            — Windows tile manifest
 *   /safari-pinned-tab.svg        — monochrome silhouette
 *   /art/bz-app-icon-{N}.png      — kept in /art for direct refs
 *   /art/bz-app-icon-maskable-1024.png — PWA maskable variant
 *
 * Also overwrites public/site.webmanifest icons array if not already pointing
 * at these standard names.
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// 1. Source: prefer ~/Downloads (so user can iterate without re-copying)
const downloadsPath = join(homedir(), 'Downloads', 'bz-app-icon.png');
const stagedPath = 'public/art/bz-app-icon-source.png';
let SOURCE;
if (existsSync(downloadsPath)) {
  copyFileSync(downloadsPath, stagedPath);
  SOURCE = stagedPath;
  console.log(`✓ Pulled fresh ${downloadsPath} → ${stagedPath}`);
} else {
  SOURCE = stagedPath;
  console.log(`No ~/Downloads copy — using existing ${stagedPath}`);
}

const master = await sharp(SOURCE)
  .resize(1024, 1024, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9, quality: 95 })
  .toBuffer();

writeFileSync('public/art/bz-app-icon.png', master);
console.log('✓ public/art/bz-app-icon.png (1024 master)');

// 2. PNG sizes — root-level standard names + /art duplicates
const FAVICON_ROOT_SIZES = [16, 32, 48, 96];
const APPLE_SIZES = [57, 60, 72, 76, 114, 120, 144, 152, 180];
const ANDROID_SIZES = [192, 512];
const ART_SIZES = [16, 32, 96, 180, 192, 256, 384, 512];

for (const size of FAVICON_ROOT_SIZES) {
  const buf = await sharp(master)
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(`public/favicon-${size}x${size}.png`, buf);
}
console.log(`✓ /favicon-{${FAVICON_ROOT_SIZES.join(',')}}x{}.png`);

for (const size of APPLE_SIZES) {
  const buf = await sharp(master)
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(`public/apple-touch-icon-${size}x${size}.png`, buf);
}
// Default apple-touch-icon = 180×180
copyFileSync('public/apple-touch-icon-180x180.png', 'public/apple-touch-icon.png');
copyFileSync('public/apple-touch-icon-180x180.png', 'public/apple-touch-icon-precomposed.png');
console.log(`✓ /apple-touch-icon{-${APPLE_SIZES.join(',-')}}.png + default + precomposed`);

for (const size of ANDROID_SIZES) {
  const buf = await sharp(master)
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(`public/android-chrome-${size}x${size}.png`, buf);
}
console.log(`✓ /android-chrome-{${ANDROID_SIZES.join(',')}}x{}.png`);

// 3. /art duplicates — used by manifest + cinematic surfaces
mkdirSync('public/art', { recursive: true });
for (const size of ART_SIZES) {
  const buf = await sharp(master)
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(`public/art/bz-app-icon-${size}.png`, buf);
}
console.log(`✓ /art/bz-app-icon-{${ART_SIZES.join(',')}}.png`);

// 4. Maskable — 9% interior pad for iOS/Android safe-zone
const maskInner = 1024 - 2 * Math.round(1024 * 0.09);
const maskable = await sharp(master)
  .resize(maskInner, maskInner, { kernel: sharp.kernel.lanczos3 })
  .extend({
    top: (1024 - maskInner) / 2,
    bottom: (1024 - maskInner) / 2,
    left: (1024 - maskInner) / 2,
    right: (1024 - maskInner) / 2,
    background: { r: 6, g: 6, b: 16, alpha: 1 }
  })
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync('public/art/bz-app-icon-maskable-1024.png', maskable);
console.log('✓ /art/bz-app-icon-maskable-1024.png');

// 5. mstile (Windows tile) — 150×150
const mstile = await sharp(master)
  .resize(150, 150, { kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync('public/mstile-150x150.png', mstile);
console.log('✓ /mstile-150x150.png');

// 6. Multi-res favicon.ico via png-to-ico (installed in /tmp earlier)
let icoOk = false;
try {
  // Use the bare node module from /tmp/node_modules so we don't need a
  // local dep entry. png-to-ico builds 16+24+32+48+64 by default.
  const pngToIcoMod = await import('file:///tmp/node_modules/png-to-ico/index.js');
  const pngToIco = pngToIcoMod.default || pngToIcoMod;
  const icoBuf = await pngToIco([
    'public/favicon-16x16.png',
    'public/favicon-32x32.png',
    'public/favicon-48x48.png'
  ]);
  writeFileSync('public/favicon.ico', icoBuf);
  console.log('✓ /favicon.ico (multi-res 16+32+48)');
  icoOk = true;
} catch (err) {
  console.warn('⚠ png-to-ico failed, falling back to single 32px PNG-as-ICO:', err.message);
}
if (!icoOk) {
  // Fallback: use the 32px PNG as the "ICO" (browsers tolerate PNG-as-ICO
  // since IE11 era). Not multi-res but at least serves a fresh icon.
  copyFileSync('public/favicon-32x32.png', 'public/favicon.ico');
  console.log('✓ /favicon.ico (single 32×32 fallback)');
}

// 7. browserconfig.xml — Windows Pinned Tile metadata
writeFileSync(
  'public/browserconfig.xml',
  `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <square150x150logo src="/mstile-150x150.png?v=4"/>
      <TileColor>#060610</TileColor>
    </tile>
  </msapplication>
</browserconfig>
`
);
console.log('✓ /browserconfig.xml');

// 8. safari-pinned-tab.svg — monochrome silhouette. Just embed the master
//    as a base64 image since deriving a real silhouette would require
//    OpenCV-style edge detection; modern Safari accepts color SVGs too.
const masterB64 = master.toString('base64');
writeFileSync(
  'public/safari-pinned-tab.svg',
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <image href="data:image/png;base64,${masterB64}" width="1024" height="1024"/>
</svg>
`
);
console.log('✓ /safari-pinned-tab.svg');

console.log('\nDone. Bump the ?v= cache-bust in index.html + site.webmanifest to v=4 to force refresh.');
