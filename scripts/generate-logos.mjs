#!/usr/bin/env node
// Ideogram v3 — generate 3 logo variants (A=lockup, B=icon, C=wordmark) for Panda Desiiignare.
// Saves to public/brand/logo-{a,b,c}.png and writes a quick-rate JSON for easy review.

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const KEY = process.env.IDEOGRAM_API_KEY;
if (!KEY) {
  console.error('IDEOGRAM_API_KEY missing — aborting logo gen');
  process.exit(1);
}

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'public/brand');
await mkdir(OUT, { recursive: true });

const VARIANTS = [
  {
    slug: 'a-lockup',
    style: 'DESIGN',
    aspect: '16x9',
    prompt:
      'Premium horizontal logo lockup for "Panda Desiiignare". ' +
      'Left: a single minimalist cyan-flag mark — a triangular pennant flag flying off a thin chrome pole, ' +
      'the flag itself is a stylized panda silhouette in profile, electric cyan #00E5FF gradient to deep midnight #060610. ' +
      'Right: the wordmark "Panda Desiiignare" in custom geometric sans-serif (Sora-like), ' +
      'tracking confident, subtly italicized "iii" in the middle of "Desiiignare". ' +
      'Below the wordmark in tiny monospace: "by bZ". ' +
      'Background: solid #060610 deep midnight black. ' +
      'Style: Bauhaus-meets-futurism. Premium tech brand. Anti-AI-slop. ' +
      'No watermarks, no extra text, no decorative flourishes, no people. ' +
      'Crisp vector-feel edges, single light source, pristine.'
  },
  {
    slug: 'b-icon',
    style: 'DESIGN',
    aspect: '1x1',
    prompt:
      'Square minimalist app icon, 1024x1024. ' +
      'A single triangular pennant flag flying off a thin chrome pole, the flag is a stylized panda silhouette ' +
      'in profile — bold, geometric, instantly readable at 16px. ' +
      'Electric cyan #00E5FF gradient to electric purple #7C3AED inside the flag. ' +
      'Pole is matte chrome. Background: deep midnight #060610 with a soft cyan radial vignette at top-left. ' +
      'Centered with breathing room. iOS app-icon safe-area aware. ' +
      'No text, no wordmark, no watermark, no extra elements. ' +
      'Premium tech brand, anti-AI-slop, crisp vector-feel.'
  },
  {
    slug: 'c-wordmark',
    style: 'DESIGN',
    aspect: '16x9',
    prompt:
      'Wordmark-only logo: "Panda Desiiignare" centered, with "by bZ" small below. ' +
      'Custom geometric sans-serif (Sora-like), confident tracking, ' +
      'subtly italicized "iii" in the middle of "Desiiignare" with cyan #00E5FF accent on the dots. ' +
      'Letterforms primarily off-white #f4f4ff. Below in JetBrains-Mono-style tiny caps: "BY  BZ" with extra spacing. ' +
      'Background: solid #060610 deep midnight. ' +
      'Style: Bauhaus-meets-futurism. Premium tech brand. ' +
      'No icon, no flag, no panda, no decorative elements, no watermark.'
  }
];

async function generate(spec) {
  const t0 = Date.now();
  const form = new FormData();
  form.append('prompt', spec.prompt);
  form.append('aspect_ratio', spec.aspect);
  form.append('rendering_speed', 'DEFAULT');
  form.append('style_type', spec.style);
  form.append('magic_prompt', 'OFF');
  form.append('num_images', '1');

  const res = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', {
    method: 'POST',
    headers: { 'Api-Key': KEY },
    body: form
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[${spec.slug}] ${res.status}: ${text.slice(0, 600)}`);
    return null;
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) {
    console.error(`[${spec.slug}] no url in response`, JSON.stringify(data).slice(0, 400));
    return null;
  }
  const img = await fetch(url);
  if (!img.ok) {
    console.error(`[${spec.slug}] download ${img.status}`);
    return null;
  }
  const buf = Buffer.from(await img.arrayBuffer());
  const file = resolve(OUT, `logo-${spec.slug}.png`);
  await writeFile(file, buf);
  console.log(`[${spec.slug}] ${(buf.length / 1024).toFixed(1)}KB in ${Date.now() - t0}ms → ${file}`);
  return { slug: spec.slug, file, bytes: buf.length, prompt: spec.prompt };
}

const results = await Promise.all(VARIANTS.map(generate));
const ok = results.filter(Boolean);
await writeFile(
  resolve(OUT, 'logos.json'),
  JSON.stringify({ generated_at: new Date().toISOString(), variants: ok }, null, 2)
);
console.log(`\nDone: ${ok.length}/${VARIANTS.length} logo variants generated.`);
console.log(`Review: open ${OUT}/logo-a-lockup.png, logo-b-icon.png, logo-c-wordmark.png`);
process.exit(ok.length === VARIANTS.length ? 0 : 1);
