#!/usr/bin/env node
// Generates the bzmusic brand mark via OpenAI gpt-image-1.
// Downloads PNG to public/art/bzmusic-logo-1024.png and derives icon-{192,256,
// 384,512}.png + apple-touch-icon.png + favicon.png via sharp.

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';

const OPENAI_KEY = execSync('/Users/Apple/.local/bin/get-secret OPENAI_API_KEY', { encoding: 'utf8' }).trim();
if (!OPENAI_KEY || OPENAI_KEY.startsWith('The file')) {
  console.error('OPENAI_API_KEY missing from get-secret');
  process.exit(1);
}

const PROMPT = `Logo for an indie music project called "bzmusic". Square 1:1.
Aesthetic: dark obsidian background #060610, vivid neon-cyan accent #00E5FF,
single-color flat vector silhouette, no text inside the mark, no characters.
Subject: a stylized lowercase "bz" letter-pair forged together as a single
geometric ligature — sharp 8px squircle corners, sound-wave bars emerging
from the right edge of the "z" implying playback. Bauhaus + cyberpunk
graphic-design discipline. Centered, generous negative space, perfectly
symmetric padding. Print-quality icon, infinitely scalable look. No textures,
no gradients, no shading, no 3D. NEVER include any letters as text inside or
around the mark — the "bz" must read as a custom letter-ligature glyph only.
Renders cleanly at 16px favicon size.`;

console.log('Calling OpenAI Images API (gpt-image-1, 1024×1024)…');
const res = await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${OPENAI_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-image-1',
    prompt: PROMPT,
    n: 1,
    size: '1024x1024',
    quality: 'high',
    background: 'opaque',
  }),
});

if (!res.ok) {
  console.error('OpenAI', res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
const b64 = data?.data?.[0]?.b64_json;
const url = data?.data?.[0]?.url;
let buf;
if (b64) {
  buf = Buffer.from(b64, 'base64');
} else if (url) {
  console.log('Downloading remote URL', url);
  buf = Buffer.from(await (await fetch(url)).arrayBuffer());
} else {
  console.error('No image data in response');
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

mkdirSync('public/art', { recursive: true });
writeFileSync('public/art/bzmusic-logo-1024.png', buf);
console.log('Wrote public/art/bzmusic-logo-1024.png', `${(buf.length / 1024).toFixed(0)}KB`);

// Derive every size we need from the master.
const sizes = [16, 32, 192, 256, 384, 512];
for (const size of sizes) {
  await sharp(buf)
    .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, quality: 95 })
    .toFile(`public/art/bzmusic-icon-${size}.png`);
  console.log(`  → bzmusic-icon-${size}.png`);
}

// Maskable variant — 10% interior pad so iOS/Android masks don't clip the mark.
await sharp(buf)
  .resize(896, 896, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .extend({ top: 64, bottom: 64, left: 64, right: 64, background: { r: 6, g: 6, b: 16, alpha: 1 } })
  .png({ compressionLevel: 9, quality: 95 })
  .toFile('public/art/bzmusic-icon-maskable-1024.png');
console.log('  → bzmusic-icon-maskable-1024.png (10% pad)');

// Apple-touch — 180×180 with rounded background.
await sharp(buf)
  .resize(180, 180, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
  .png({ compressionLevel: 9, quality: 95 })
  .toFile('public/art/bzmusic-apple-touch.png');
console.log('  → bzmusic-apple-touch.png');

console.log('\nDone. Update site.webmanifest + index.html <link rel="icon"> next.');
