#!/usr/bin/env node
/**
 * Build the bZ Music logo as a HORIZONTAL INLINE lockup:
 *
 *   ┌──┐
 *   │bz│  Music
 *   └──┘
 *
 * - Left: custom-drawn lowercase "bz" ligature glyph in neon cyan #00E5FF
 *         with 2 sound-wave bars on the right edge (reads as "bZ").
 * - Right: the word "Music" in Sora 900 (Black) wordmark, off-white #F4F4FF.
 *
 * Playwright headless Chromium renders the HTML+SVG with the Sora webfont
 * loaded from Google Fonts so type comes out pixel-perfect (no DALL-E text
 * drift). Sharp then derives every icon size from the master.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';

// Master horizontal canvas. Roughly 5:1 aspect — gives the wordmark + glyph
// room to breathe without becoming a wide banner.
const W = 1600;
const H = 500;

// Inline HTML with @import for Sora 900. document.fonts.ready before
// screenshot guarantees the webfont is loaded. The bZ "logo" portion uses
// the same Sora 900 letterforms as "Music" — typographically unified,
// just colored cyan with sound bars. Reads instantly as "bZ Music".
const HTML = `<!doctype html><html><head><meta charset="utf-8" /><style>
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@900&display=swap');
  html, body { margin: 0; padding: 0; background: #060610; }
  body {
    width: ${W}px;
    height: ${H}px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    font-family: 'Sora', system-ui, sans-serif;
    font-weight: 900;
    line-height: 1;
  }
  .lockup {
    display: inline-flex;
    align-items: center;
    gap: 32px;
  }
  .mark {
    position: relative;
    display: inline-flex;
    align-items: baseline;
    color: #00E5FF;
    font-size: 280px;
    letter-spacing: -0.04em;
    filter: drop-shadow(0 0 28px rgba(0, 229, 255, 0.45));
    padding-right: 38px;
  }
  .mark .bars {
    position: absolute;
    right: 0;
    bottom: 36px;
    display: inline-flex;
    align-items: flex-end;
    gap: 6px;
    height: 110px;
  }
  .mark .bars i {
    display: block;
    width: 12px;
    background: currentColor;
    border-radius: 6px;
  }
  .mark .bars i:nth-child(1) { height: 60%; }
  .mark .bars i:nth-child(2) { height: 100%; }
  .word {
    font-size: 280px;
    color: #F4F4FF;
    letter-spacing: -0.025em;
    /* baseline tweak so the Sora cap of "M" sits visually centered with
       the bZ mark's x-height-tall letterforms. */
    transform: translateY(-2px);
  }
</style></head><body>
  <div class="lockup">
    <span class="mark">bZ<span class="bars" aria-hidden="true"><i></i><i></i></span></span>
    <span class="word">Music</span>
  </div>
</body></html>`;

// Second HTML for the favicon-only "bZ" mark — same letterform + sound bars
// as the lockup but cropped tight + sized for icon use. At ≤96px favicon
// scale the "Music" word becomes unreadable, so favicons drop it entirely
// and lean on the cyan glyph as the recognizable brand element.
const MARK_W = 800;
const MARK_H = 800;
const MARK_HTML = `<!doctype html><html><head><meta charset="utf-8" /><style>
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@900&display=swap');
  html, body { margin: 0; padding: 0; background: #060610; }
  body {
    width: ${MARK_W}px;
    height: ${MARK_H}px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Sora', system-ui, sans-serif;
    font-weight: 900;
    line-height: 1;
  }
  .mark {
    position: relative;
    display: inline-flex;
    align-items: baseline;
    color: #00E5FF;
    font-size: 560px;
    letter-spacing: -0.04em;
    filter: drop-shadow(0 0 56px rgba(0, 229, 255, 0.55));
    padding-right: 76px;
  }
  .mark .bars {
    position: absolute;
    right: 0;
    bottom: 72px;
    display: inline-flex;
    align-items: flex-end;
    gap: 12px;
    height: 220px;
  }
  .mark .bars i {
    display: block;
    width: 24px;
    background: currentColor;
    border-radius: 12px;
  }
  .mark .bars i:nth-child(1) { height: 60%; }
  .mark .bars i:nth-child(2) { height: 100%; }
</style></head><body>
  <span class="mark">bZ<span class="bars" aria-hidden="true"><i></i><i></i></span></span>
</body></html>`;

mkdirSync('public/art', { recursive: true });

const browser = await chromium.launch();

// 1. Wordmark lockup (full "bZ Music" inline)
const ctx1 = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
});
const page1 = await ctx1.newPage();
await page1.setContent(HTML, { waitUntil: 'networkidle' });
await page1.evaluate(() => document.fonts.ready);
const masterBuf = await page1.screenshot({
  type: 'png',
  fullPage: false,
  omitBackground: false,
  clip: { x: 0, y: 0, width: W, height: H },
  scale: 'device',
});
await ctx1.close();

// 2. Mark-only (bZ glyph for favicons)
const ctx2 = await browser.newContext({
  viewport: { width: MARK_W, height: MARK_H },
  deviceScaleFactor: 2,
});
const page2 = await ctx2.newPage();
await page2.setContent(MARK_HTML, { waitUntil: 'networkidle' });
await page2.evaluate(() => document.fonts.ready);
const markBuf = await page2.screenshot({
  type: 'png',
  fullPage: false,
  omitBackground: false,
  clip: { x: 0, y: 0, width: MARK_W, height: MARK_H },
  scale: 'device',
});
await ctx2.close();

await browser.close();

writeFileSync('public/art/bzmusic-wordmark-3200.png', masterBuf);
console.log(`master: 3200×1000 → public/art/bzmusic-wordmark-3200.png (${(masterBuf.length / 1024).toFixed(0)}KB)`);

// Derive a normalized 1600×500 wordmark for direct use on site surfaces.
await sharp(masterBuf)
  .resize(1600, 500, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9, quality: 95 })
  .toFile('public/art/bzmusic-wordmark.png');
console.log('  → bzmusic-wordmark.png (1600×500)');

/**
 * Build a square favicon. Switches source automatically:
 * - <= 96px → mark-only (bZ glyph) so the icon stays legible at tab/dock scale
 * - >  96px → full inline lockup, gives the wordmark room to breathe
 */
async function squareFavicon(size, paddingRatio = 0.08) {
  const useMark = size <= 96;
  const src = useMark ? markBuf : masterBuf;
  const srcW = useMark ? MARK_W : W;
  const srcH = useMark ? MARK_H : H;
  const contentSize = Math.round(size * (1 - 2 * paddingRatio));
  const resized = await sharp(src)
    .resize(contentSize, Math.round(contentSize * (srcH / srcW)), {
      fit: useMark ? 'cover' : 'contain',
      background: { r: 6, g: 6, b: 16, alpha: 1 },
      kernel: sharp.kernel.lanczos3,
    })
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 6, g: 6, b: 16, alpha: 1 },
    },
  })
    .composite([{ input: resized, gravity: 'center' }])
    .png({ compressionLevel: 9, quality: 95 })
    .toBuffer();
}

for (const size of [16, 32, 192, 256, 384, 512]) {
  const buf = await squareFavicon(size);
  writeFileSync(`public/art/bzmusic-icon-${size}.png`, buf);
  console.log(`  → bzmusic-icon-${size}.png`);
}

// Maskable variant: extra interior padding so iOS/Android masks don't clip.
const maskable = await squareFavicon(1024, 0.18);
writeFileSync('public/art/bzmusic-icon-maskable-1024.png', maskable);
console.log('  → bzmusic-icon-maskable-1024.png (18% pad)');

// Apple touch icon — 180×180. Large enough that lockup is still readable.
const appleTouch = await squareFavicon(180, 0.06);
writeFileSync('public/art/bzmusic-apple-touch.png', appleTouch);
console.log('  → bzmusic-apple-touch.png');

// 1024 square master uses the full lockup.
const master1024 = await squareFavicon(1024, 0.08);
writeFileSync('public/art/bzmusic-logo-1024.png', master1024);
console.log('  → bzmusic-logo-1024.png (1024 square master)');

// Standalone mark-only PNG for the AI chat FAB + future inline-mark use.
await sharp(markBuf)
  .resize(256, 256, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9, quality: 95 })
  .toFile('public/art/bzmusic-mark-256.png');
console.log('  → bzmusic-mark-256.png (square mark only)');

console.log('\nDone. New inline-lockup logo across all icon sizes.');
