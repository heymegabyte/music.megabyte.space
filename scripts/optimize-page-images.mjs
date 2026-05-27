import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';

const dir = 'public/art/pages';
const files = readdirSync(dir).filter(f => f.endsWith('.png'));

for (const f of files) {
  const path = `${dir}/${f}`;
  const before = statSync(path).size;
  // Resize 1536→1280 (still high quality for retina 640px display) + max compression
  const buf = await sharp(path)
    .resize(1280, null, { withoutEnlargement: true })
    .png({ compressionLevel: 9, quality: 86, effort: 10 })
    .toBuffer();
  await sharp(buf).toFile(path);
  const after = statSync(path).size;
  console.log(`${f}: ${(before/1024).toFixed(0)}KB → ${(after/1024).toFixed(0)}KB`);
}
