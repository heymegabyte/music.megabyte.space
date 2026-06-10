#!/usr/bin/env node
/**
 * Generates unique og:image cards (1200×630) for each content page +
 * one additional inline cinematic image per page.
 *
 * og:image cards include the page title prominently — these are the link
 * unfurl previews that appear on X/Discord/iMessage/Slack/Notion.
 */

import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import sharp from 'sharp';

const OPENAI_KEY = execSync('/Users/Apple/.local/bin/get-secret OPENAI_API_KEY', { encoding: 'utf8' }).trim();
if (!OPENAI_KEY || OPENAI_KEY.startsWith('The file')) {
  console.error('OPENAI_API_KEY missing');
  process.exit(1);
}

const HOUSE_STYLE =
  'Dark obsidian background #060610, vivid neon cyan #00E5FF accents, ' +
  'magazine-editorial composition, dramatic lighting, fine 35mm film grain, ' +
  'NEVER include logos or watermarks. ';

const TARGETS = [
  // ── og:image cards (1536×1024, will be cropped to 1200×630) ───────────
  {
    file: 'og-about.png',
    type: 'og',
    prompt:
      `Editorial portrait composition. A man's silhouette at a Newark studio desk, ` +
      `monitors glowing cyan in the dark, vinyl wall, microphone in foreground. Bold text overlay ` +
      `area on the left half kept dark for typography. Cinematic depth-of-field. ${HOUSE_STYLE}`
  },
  {
    file: 'og-process.png',
    type: 'og',
    prompt:
      `Abstract music-production pipeline diagram — five glowing cyan stages flowing ` +
      `left to right against pure black: handwriting, AI gears, audio waveform, frequency bars, ` +
      `glowing speaker. Geometric vector style. Left third intentionally negative for text. ${HOUSE_STYLE}`
  },
  {
    file: 'og-theology.png',
    type: 'og',
    prompt:
      `Modern stained-glass cross made of soup ladles + bread loaves, dramatic light ` +
      `streaming into a darkened soup-kitchen interior with stainless steel counters. ` +
      `Left third of the frame intentionally darkened for text overlay. ${HOUSE_STYLE}`
  },
  {
    file: 'og-credits.png',
    type: 'og',
    prompt:
      `Data-visualization abstract — neon cyan frequency-spectrum bars + nodes + ` +
      `connection lines forming a network graph against pure black background. ` +
      `Magazine-cover aesthetic. Left third dark for typography. ${HOUSE_STYLE}`
  },
  {
    file: 'og-press.png',
    type: 'og',
    prompt:
      `Stack of 6 vinyl record sleeves arranged in a fan, each slightly visible with ` +
      `cyan-tinted album art glimpses. Press-kit aesthetic. Dramatic side-lighting. Newspaper ` +
      `clipping texture behind the stack. Left third dark for headline text. ${HOUSE_STYLE}`
  },
  {
    file: 'og-contact.png',
    type: 'og',
    prompt:
      `Newark NJ skyline at twilight from across the Passaic river, cathedral spires + ` +
      `brick buildings + glowing cyan windows + dramatic cyan-tinted clouds. Reflection on water. ` +
      `Left third intentionally dark for text overlay. ${HOUSE_STYLE}`
  },
  {
    file: 'og-support.png',
    type: 'og',
    prompt:
      `Two open hands meeting in dark space, a single cyan glowing seed of light passing ` +
      `between them. Symbolic of generosity + support. Photorealistic skin texture, ` +
      `dramatic rim lighting. Left third dark for text overlay. ${HOUSE_STYLE}`
  },

  // ── Additional inline page images (1536×1024 cinematic 16:10) ─────────
  {
    file: 'about-studio-2.png',
    type: 'inline',
    prompt:
      `Close-up of hands writing lyrics in a leather notebook at a wooden desk, ` +
      `warm desk-lamp light, vinyl records stacked behind, a coffee mug + open Bible visible. ` +
      `Cinematic depth-of-field, magazine editorial. ${HOUSE_STYLE}`
  },
  {
    file: 'process-suno-takes.png',
    type: 'inline',
    prompt:
      `Cinematic still life — a dark wooden table with 12 vinyl records arranged in ` +
      `a grid, 7 of them tagged with red rejection stickers, 5 with cyan approval marks. ` +
      `Overhead lighting. Symbolic of the curation step. ${HOUSE_STYLE}`
  },
  {
    file: 'theology-soup-kitchen.png',
    type: 'inline',
    prompt:
      `Real soup kitchen interior — long stainless steel serving counter, steam ` +
      `rising from large pots, dim light from above, hands reaching to receive bowls. ` +
      `Documentary photography aesthetic, dignified, no faces visible. Newark grit. ${HOUSE_STYLE}`
  },
  {
    file: 'credits-spectrum.png',
    type: 'inline',
    prompt:
      `Real-time audio frequency analyzer display — vertical bars in cyan gradient ` +
      `against pure black, with subtle reflection on a glossy surface. Studio monitor aesthetic. ` +
      `Equipment rack visible in background, defocused. ${HOUSE_STYLE}`
  },
  {
    file: 'press-magazine.png',
    type: 'inline',
    prompt:
      `Magazine spread mockup — a Rolling-Stone-style spread on a dark wooden table, ` +
      `page open with a music profile, headphones + cup of coffee nearby. Cinematic warm ` +
      `desk lamp side-light. Newspaper texture on the page. ${HOUSE_STYLE}`
  },
  {
    file: 'contact-phone-desk.png',
    type: 'inline',
    prompt:
      `A smartphone on a dark wooden desk, screen displaying a clean email composer ` +
      `with cyan accent. A potted plant + cup of black coffee + brass desk lamp casting ` +
      `warm light from the side. Cinematic top-down composition. ${HOUSE_STYLE}`
  },
  {
    file: 'support-tipjar.png',
    type: 'inline',
    prompt:
      `A clear glass tip jar on a dark wood counter with a few folded bills + a single ` +
      `glowing cyan coin in the middle, soft top-down studio lighting. Symbolic of voluntary ` +
      `support. ${HOUSE_STYLE}`
  }
];

mkdirSync('public/art/pages', { recursive: true });
mkdirSync('public/og', { recursive: true });

async function genOne(t) {
  console.log(`→ ${t.file}…`);
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: t.prompt,
      n: 1,
      size: '1536x1024',
      quality: 'high',
      background: 'opaque'
    })
  });
  if (!res.ok) {
    console.error(`✗ ${t.file}`, res.status, await res.text());
    return;
  }
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  const url = data?.data?.[0]?.url;
  let buf;
  if (b64) buf = Buffer.from(b64, 'base64');
  else if (url) buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  else {
    console.error(`✗ ${t.file} — no image data`);
    return;
  }

  if (t.type === 'og') {
    // OG cards: crop 1536×1024 → 1200×630 (1.91:1) + max compression
    const optimized = await sharp(buf)
      .resize(1200, 630, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 82, progressive: true })
      .toBuffer();
    writeFileSync(`public/og/${t.file.replace('.png', '.jpg')}`, optimized);
    console.log(`✓ public/og/${t.file.replace('.png', '.jpg')} (${(optimized.length / 1024).toFixed(0)}KB)`);
  } else {
    // Inline page images: resize + compress
    const optimized = await sharp(buf)
      .resize(1280, null, { withoutEnlargement: true })
      .png({ compressionLevel: 9, quality: 86, effort: 10 })
      .toBuffer();
    writeFileSync(`public/art/pages/${t.file}`, optimized);
    console.log(`✓ public/art/pages/${t.file} (${(optimized.length / 1024).toFixed(0)}KB)`);
  }
}

await Promise.all(TARGETS.map(genOne));
console.log('\nDone — 7 og:images + 7 inline images generated.');
