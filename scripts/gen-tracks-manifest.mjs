#!/usr/bin/env node
// Build-time manifest of every track for press-release / future API consumers.
// Reads src/data.ts via regex (the same lightweight parser used by alignment),
// writes public/tracks.json with { id, title, album }.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '..');
const src = await readFile(resolve(ROOT, 'src/data.ts'), 'utf8');
const start = src.search(/export const TRACKS\s*:\s*Track\[\]\s*=\s*\[/);
const region = src.slice(start);
const blocks = region.match(/\{\s*id:\s*['"][^'"]+['"],\s*title:\s*['"][^'"]+['"][\s\S]*?wisdom:[^\n]+\n\s*\}/g) || [];
const tracks = blocks.map(b => ({
  id: b.match(/id:\s*['"]([^'"]+)['"]/)?.[1],
  title: b.match(/title:\s*['"]([^'"]+)['"]/)?.[1],
  album: b.match(/album:\s*['"]([^'"]+)['"]/)?.[1],
})).filter(t => t.id);
await writeFile(resolve(ROOT, 'public/tracks.json'), JSON.stringify(tracks));
console.log(`tracks.json: ${tracks.length} tracks`);
