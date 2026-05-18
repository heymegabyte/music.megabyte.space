import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error('OPENAI_API_KEY missing — aborting cover generation');
  process.exit(1);
}

const OUT = join(process.cwd(), 'public', 'art');

const COVERS = [
  {
    file: 'cover-panda-desiiignare.png',
    prompt:
      'Album cover art, 1024x1024 square, gorgeous beautiful love stars cinematic. ' +
      'A cyan-and-white panda warrior in iridescent oil-slick armor holds a glowing chrome flag, ' +
      'standing on a marble plinth surrounded by golden constellations and a soft pink-purple-cyan nebula. ' +
      'Hand-drawn calligraphy reads "Panda Desiiignare" across the top in liquid neon-cyan. ' +
      'Below: "by bZ". Bauhaus-meets-futurism, ultra-detailed, anti-AI-slop, premium gallery print. ' +
      'No watermarks. Saturated cyan #00E5FF, electric purple #7C3AED, deep midnight #060610.'
  },
  {
    file: 'cover-panda-dump.png',
    prompt:
      'Album cover art, 1024x1024 square. A glossy ceramic panda head spilling a chrome torrent of cassette tapes, ' +
      'vinyl shards, cyan glitch fragments, and tiny gold coins onto a black-marble floor. ' +
      'Rim-lit cyan and electric magenta. Hand-painted gothic-graffiti title "PANDA DUMP" in ribboned gold leaf, ' +
      '"by bZ" debossed underneath. Gritty premium album-art texture, 35mm grain, anti-AI-slop. ' +
      'Color palette: cyan #00E5FF, magenta #FF2DA0, gold #F5C24A, deep midnight #060610.'
  },
  {
    file: 'cover-st-johns-canon.png',
    prompt:
      'Album cover art, 1024x1024 square. A baroque cathedral of stainless steel and stained-cyan glass ' +
      'dissolves into pixel rain over a soup-kitchen table piled with bread, bowls, and a single chrome panda. ' +
      'A halo of light beams down through circuit-pattern clerestory windows. ' +
      'Title in serif-blackletter "St Johns Canon" embossed across the top, "by bZ" carved in stone below. ' +
      'Sacred-tech, holy-machine, hyperdetail. Cyan #00E5FF, gold #F5C24A, ivory, deep midnight #060610.'
  },
  {
    file: 'cover-galactic-gospel.png',
    prompt:
      'Album cover art, 1024x1024 square. A choir of small chrome aliens lifts up a cyan ' +
      'panda flag while standing on the rings of a glowing golden saturn. ' +
      'Behind them: a hand-drawn rainbow arcs into a pot of pixel-gold; a tiny digital leprechaun winks. ' +
      'Title "GALACTIC GOSPEL" in airbrushed-chrome arc-text, "by bZ" in stardust below. ' +
      'Fairground-poster meets cosmic-cathedral, ultra-saturated, anti-AI-slop. ' +
      'Cyan #00E5FF, holy gold #F5C24A, electric purple #7C3AED, deep midnight #060610.'
  }
];

async function generate(spec) {
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: spec.prompt,
      size: '1024x1024',
      quality: 'high',
      n: 1
    })
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`[${spec.file}] ${res.status}: ${text.slice(0, 400)}`);
    return false;
  }
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    console.error(`[${spec.file}] no image in response`);
    return false;
  }
  await writeFile(join(OUT, spec.file), Buffer.from(b64, 'base64'));
  console.log(`[${spec.file}] ok in ${Date.now() - t0}ms`);
  return true;
}

const results = await Promise.all(COVERS.map(generate));
const wins = results.filter(Boolean).length;
console.log(`Done: ${wins}/${COVERS.length} covers generated`);
process.exit(wins === COVERS.length ? 0 : 1);
