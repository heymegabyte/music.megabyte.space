#!/usr/bin/env node
/**
 * Generates DALL-E supporting images for the content pages.
 * Each image gets a tight cinematic prompt anchored on the bZ visual
 * language: dark obsidian + neon cyan + dramatic lighting + Newark grit.
 *
 * Runs 6 images in parallel via Promise.all to keep wall-clock under
 * 30 seconds for the full set.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';

const OPENAI_KEY = execSync('/Users/Apple/.local/bin/get-secret OPENAI_API_KEY', { encoding: 'utf8' }).trim();
if (!OPENAI_KEY || OPENAI_KEY.startsWith('The file')) {
  console.error('OPENAI_API_KEY missing'); process.exit(1);
}

const HOUSE_STYLE =
  'Cinematic, dark obsidian background #060610, vivid neon cyan #00E5FF accents, ' +
  'dramatic lighting, magazine-editorial composition, no AI plastic skin, no waxy faces, ' +
  'fine 35mm film grain, no text inside the frame, no logos, no watermarks. ' +
  'Hyper-realistic where applicable, geometric vector where abstract. 16:9 cinematic crop.';

const IMAGES = [
  {
    file: 'about-hero.png',
    prompt: `Brian Zalewski's workspace — dimly-lit Newark studio at night. Multiple ` +
      `monitors glowing with code editor + audio waveforms, a microphone in the foreground, ` +
      `vinyl records on a shelf, a Bible open on the desk, soft cyan rim-lighting from the screens. ` +
      `${HOUSE_STYLE}`,
    size: '1536x1024',
  },
  {
    file: 'process-pipeline.png',
    prompt: `Abstract data-flow visualization showing five stages of music production — ` +
      `lyrics paper → AI generation → audio waveform → frequency spectrum → glowing speaker, ` +
      `arranged left-to-right with thin neon-cyan flow lines connecting them. Black background. ` +
      `Single-color flat vector illustration. ${HOUSE_STYLE}`,
    size: '1536x1024',
  },
  {
    file: 'theology-stained-glass.png',
    prompt: `Modern stained glass window depicting a cross made of soup ladles + bread loaves, ` +
      `set against dramatic blue-and-cyan light pouring through the window into a dark soup-kitchen ` +
      `interior with stainless steel counters in the foreground. Reverent, hopeful, gritty. ` +
      `${HOUSE_STYLE}`,
    size: '1536x1024',
  },
  {
    file: 'credits-data-viz.png',
    prompt: `Abstract data visualization of audio frequencies — vertical bars in neon cyan ` +
      `gradient (#00E5FF top, #50AAE3 bottom) on pure black, with thin connecting lines ` +
      `between bar tops forming a wave pattern. Cinematographic depth-of-field, glow effect. ` +
      `${HOUSE_STYLE}`,
    size: '1536x1024',
  },
  {
    file: 'contact-newark.png',
    prompt: `Newark, NJ skyline at twilight from across the Passaic River. Cathedral spires + ` +
      `brick buildings + glowing windows + cyan-tinted clouds. Dramatic editorial photography, ` +
      `slight cyan color grading. ${HOUSE_STYLE}`,
    size: '1536x1024',
  },
  {
    file: 'support-hands.png',
    prompt: `Two open hands reaching toward each other against pure black background, one ` +
      `hand giving a small glowing cyan light, the other receiving it. Symbolic of generosity ` +
      `+ support. Photorealistic skin texture, dramatic rim lighting, single ray of cyan light ` +
      `between the hands. ${HOUSE_STYLE}`,
    size: '1536x1024',
  },
];

mkdirSync('public/art/pages', { recursive: true });

async function genOne(img) {
  console.log(`→ ${img.file}…`);
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: img.prompt,
      n: 1,
      size: img.size,
      quality: 'high',
      background: 'opaque',
    }),
  });
  if (!res.ok) {
    console.error(`✗ ${img.file}`, res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  const url = data?.data?.[0]?.url;
  let buf;
  if (b64) buf = Buffer.from(b64, 'base64');
  else if (url) buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  else { console.error(`✗ ${img.file} — no image data`); return null; }
  const path = `public/art/pages/${img.file}`;
  writeFileSync(path, buf);
  console.log(`✓ ${path} (${(buf.length / 1024).toFixed(0)}KB)`);
  return path;
}

// Generate all in parallel
await Promise.all(IMAGES.map(genOne));
console.log('\nDone.');
