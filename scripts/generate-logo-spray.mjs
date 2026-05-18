#!/usr/bin/env node
// Ideogram v3 — generate the spray-paint "bZ" tag for use as the new brand mark + favicon source.
// Saves to public/brand/logo-spray.png. Originals (logo-{a,b,c}*.png) remain as backup.

import { writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const KEY = process.env.IDEOGRAM_API_KEY;
if (!KEY) {
  console.error('IDEOGRAM_API_KEY missing — aborting spray-paint logo gen');
  process.exit(1);
}

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'public/brand');
await mkdir(OUT, { recursive: true });

// Up to 3 prompt attempts, descending in spec but holding the brand color + tag form.
// Pick best of three by inspection — script saves all three then promotes the chosen one
// to logo-spray.png. Default promotes attempt 1; pass --pick=2 or --pick=3 to override.
const PROMPTS = [
  // Attempt 1 — most detailed, drips + overspray + magenta accents
  'Spray-paint graffiti tag of the lowercase letter "b" followed by uppercase "Z" — written as "bZ" — vivid cyan #00E5FF aerosol on solid black background. ' +
    'Wet drip lines underneath each letter. Slight magenta and electric-blue overspray on the edges. ' +
    'Crisp street-art tag, hand-style, raw. NO additional text or letters. NO outlines or borders. ' +
    'NO background scenery. Centered on solid black. High-resolution, square format, 1:1.',

  // Attempt 2 — leaner, emphasizes single tag + readability at small sizes
  'A single graffiti tag reading exactly "bZ" (lowercase b, uppercase Z, two characters only). ' +
    'Bold cyan #00E5FF spray paint with thick vertical drip streaks under both letters. Tiny magenta overspray dots scattered around the letters. ' +
    'Tight composition, the tag fills 70% of the frame, centered, on pure solid black background. ' +
    'Hand-painted aerosol texture, slightly wet, glossy. No other letters, words, numbers, or graphics. Square 1:1.',

  // Attempt 3 — fallback with maximum constraint, last-resort cleaner version
  'Two-character graffiti tag "bZ" (just lowercase b then uppercase Z). ' +
    'Electric cyan #00E5FF aerosol spray paint, with realistic paint drips dripping straight down from the bottom of each letter. ' +
    'Subtle hot pink #FF2D95 overspray haze on edges. Background: pure black #000000. ' +
    'No outlines. No borders. No text other than "bZ". No background imagery. ' +
    'Centered, 1:1 square aspect ratio, high resolution, photographic detail of the spray-paint texture.'
];

async function generate(idx, prompt) {
  const t0 = Date.now();
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('aspect_ratio', '1x1');
  form.append('rendering_speed', 'DEFAULT');
  form.append('style_type', 'DESIGN');
  form.append('magic_prompt', 'OFF');
  form.append('num_images', '1');

  const res = await fetch('https://api.ideogram.ai/v1/ideogram-v3/generate', {
    method: 'POST',
    headers: { 'Api-Key': KEY },
    body: form
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[attempt ${idx + 1}] ${res.status}: ${text.slice(0, 600)}`);
    return null;
  }
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) {
    console.error(`[attempt ${idx + 1}] no url in response`, JSON.stringify(data).slice(0, 400));
    return null;
  }
  const img = await fetch(url);
  if (!img.ok) {
    console.error(`[attempt ${idx + 1}] download ${img.status}`);
    return null;
  }
  const buf = Buffer.from(await img.arrayBuffer());
  const file = resolve(OUT, `logo-spray-attempt-${idx + 1}.png`);
  await writeFile(file, buf);
  console.log(`[attempt ${idx + 1}] ${(buf.length / 1024).toFixed(1)}KB in ${Date.now() - t0}ms → ${file}`);
  return { idx, file, bytes: buf.length, prompt };
}

const results = [];
for (let i = 0; i < PROMPTS.length; i++) {
  const r = await generate(i, PROMPTS[i]);
  if (r) results.push(r);
}

if (!results.length) {
  console.error('All attempts failed.');
  process.exit(1);
}

// --pick CLI override (1-indexed); default to 1
const pickArg = process.argv.find((a) => a.startsWith('--pick='));
const pick = pickArg ? Math.max(1, Math.min(PROMPTS.length, Number(pickArg.split('=')[1]))) : 1;
const chosen = results.find((r) => r.idx === pick - 1) || results[0];

// Promote chosen attempt → logo-spray.png
const finalPath = resolve(OUT, 'logo-spray.png');
const { copyFile } = await import('node:fs/promises');
await copyFile(chosen.file, finalPath);
const st = await stat(finalPath);
console.log(`\nPromoted attempt ${chosen.idx + 1} → ${finalPath} (${(st.size / 1024).toFixed(1)}KB)`);

await writeFile(
  resolve(OUT, 'logo-spray.json'),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      chosen_attempt: chosen.idx + 1,
      chosen_prompt: chosen.prompt,
      attempts: results.map((r) => ({ attempt: r.idx + 1, file: r.file, bytes: r.bytes }))
    },
    null,
    2
  )
);
console.log(`Done: ${results.length}/${PROMPTS.length} attempts saved.`);
