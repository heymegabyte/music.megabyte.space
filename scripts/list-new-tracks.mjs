#!/usr/bin/env node
// Print track ids present in current src/data.ts but absent in a base ref.
//
//   node scripts/list-new-tracks.mjs [base-ref]
//
// Default base-ref = HEAD~1. Output: one track id per line, suitable for `xargs`.

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const baseRef = process.argv[2] || 'HEAD~1';

function extractIds(src) {
  const m = src.match(/export const TRACKS\s*:\s*[A-Za-z\[\]]+\s*=\s*\[([\s\S]*?)\n\];/);
  if (!m) return [];
  return [...m[1].matchAll(/^\s*id:\s*'([a-z0-9-]+)'/gm)].map(x => x[1]);
}

async function readCurrent() {
  return readFile(resolve(ROOT, 'src/data.ts'), 'utf8');
}
function readAtRef(ref) {
  try {
    return execFileSync('git', ['show', `${ref}:src/data.ts`], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    return '';
  }
}

const [now, before] = [await readCurrent(), readAtRef(baseRef)];
const nowIds = new Set(extractIds(now));
const beforeIds = new Set(extractIds(before));
const added = [...nowIds].filter(id => !beforeIds.has(id));
for (const id of added) console.log(id);
