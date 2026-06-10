#!/usr/bin/env node
// Pull authoritative lyrics for every track in src/data.ts from your Suno
// account history and merge them in. No official Suno API exists; this hits
// the same internal feed endpoint suno.com uses, authenticated with your
// browser session cookie.
//
//   1. Open https://suno.com/me in Chrome (logged in).
//   2. DevTools → Application → Cookies → suno.com → copy ENTIRE cookie header
//      (everything in the "Cookie" request header, not just one entry).
//   3. Save it: `export SUNO_COOKIE='<paste>'` OR `chezmoi edit ...secrets.../SUNO_COOKIE`.
//   4. node scripts/fetch-suno-lyrics.mjs            # writes data/suno-feed.json
//      node scripts/fetch-suno-lyrics.mjs --merge    # also patches src/data.ts (only when match score ≥0.85)
//      node scripts/fetch-suno-lyrics.mjs --dry      # print matches, no write
//
// Cookie expires periodically — refresh the env var and re-run.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_PATH = resolve(ROOT, 'src/data.ts');
const FEED_OUT = resolve(ROOT, 'data/suno-feed.json');

const SUNO_BASE = 'https://studio-api.prod.suno.com';
const FEED_PATH = '/api/feed/v2';
const PAGE_SIZE = 50;

const flags = new Set(process.argv.slice(2));
const doMerge = flags.has('--merge');
const dryRun = flags.has('--dry');
const SUNO_COOKIE = process.env.SUNO_COOKIE;
const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

if (!SUNO_COOKIE) {
  console.error('SUNO_COOKIE not set. Open https://suno.com/me, copy your Cookie header, and:');
  console.error("  export SUNO_COOKIE='<paste>'");
  process.exit(2);
}

async function fetchPage(page) {
  const url = `${SUNO_BASE}${FEED_PATH}?page=${page}&page_size=${PAGE_SIZE}&type=user&list_status=&order=created_at_desc`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': REAL_UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: SUNO_COOKIE,
      Referer: 'https://suno.com/me',
      Origin: 'https://suno.com'
    }
  });
  if (r.status === 401 || r.status === 403) {
    throw new Error(`Suno auth failed (${r.status}). Refresh SUNO_COOKIE from your browser.`);
  }
  if (!r.ok) throw new Error(`Suno feed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function fetchAllClips() {
  const all = [];
  for (let page = 1; page <= 30; page++) {
    const data = await fetchPage(page);
    const clips = data?.clips || data?.results || data?.audios || [];
    if (!clips.length) break;
    all.push(...clips);
    if (clips.length < PAGE_SIZE) break;
    await new Promise(r => setTimeout(r, 250));
  }
  return all;
}

/** Strip Suno [Verse]/[Chorus]/etc section markers + collapse blank lines. */
function cleanLyrics(prompt) {
  if (!prompt) return [];
  return prompt
    .split('\n')
    .map(l => l.replace(/^\s*\[[^\]]+\]\s*$/, '').trim())
    .filter(Boolean);
}

function normalizeTitle(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccard(a, b) {
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  const inter = [...A].filter(x => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 0;
}

function bestMatch(track, clips) {
  const target = normalizeTitle(track.title);
  let best = null;
  for (const clip of clips) {
    const t = normalizeTitle(clip?.title || clip?.metadata?.tags || '');
    if (!t) continue;
    const score = jaccard(target, t);
    if (!best || score > best.score) best = { clip, score };
  }
  return best;
}

async function main() {
  process.stderr.write('Fetching Suno feed…\n');
  const clips = await fetchAllClips();
  process.stderr.write(`Got ${clips.length} clips from Suno history.\n`);
  await mkdir(resolve(ROOT, 'data'), { recursive: true });
  await writeFile(FEED_OUT, JSON.stringify({ fetched_at: new Date().toISOString(), clips }, null, 2));
  process.stderr.write(`Wrote ${FEED_OUT}\n`);

  const src = await readFile(DATA_PATH, 'utf8');
  const trackBlocks = [
    ...src.matchAll(
      /\{\s*id:\s*'([a-z0-9-]+)'[\s\S]*?title:\s*'([^']+)'[\s\S]*?lyrics:\s*\[([\s\S]*?)\n\s{4}\]/g
    )
  ];
  const matches = [];
  for (const tm of trackBlocks) {
    const track = { id: tm[1], title: tm[2] };
    const m = bestMatch(track, clips);
    if (!m) continue;
    matches.push({
      track,
      score: m.score,
      sunoId: m.clip?.id,
      sunoTitle: m.clip?.title,
      lyrics: cleanLyrics(m.clip?.metadata?.prompt || m.clip?.metadata?.lyric)
    });
  }

  matches.sort((a, b) => b.score - a.score);
  console.log('\nTop matches:');
  for (const m of matches.slice(0, 12)) {
    console.log(`  ${m.score.toFixed(2)}  ${m.track.id}  ←  "${m.sunoTitle}" (${m.sunoId})`);
  }
  const lowConf = matches.filter(m => m.score < 0.85);
  if (lowConf.length) {
    console.log(`\n${lowConf.length} match(es) below 0.85 — review before merge.`);
  }

  if (!doMerge) {
    console.log('\nRun with --merge to patch src/data.ts (only matches ≥0.85 with non-empty lyrics).');
    return;
  }

  let out = src;
  let patched = 0;
  for (const m of matches) {
    if (m.score < 0.85 || !m.lyrics.length) continue;
    const blockRe = new RegExp(
      `(\\{\\s*id:\\s*'${m.track.id}'[\\s\\S]*?lyrics:\\s*\\[)([\\s\\S]*?)(\\n\\s{4}\\])`
    );
    const lit = m.lyrics.map(l => `      '${l.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`).join(',\n');
    const next = out.replace(blockRe, `$1\n${lit}\n    ]`);
    if (next !== out) {
      out = next;
      patched++;
    }
  }

  if (dryRun) {
    console.log(`[dry] would patch ${patched} track(s).`);
    return;
  }
  if (patched) {
    await writeFile(DATA_PATH, out, 'utf8');
    console.log(`Patched lyrics for ${patched} track(s) in src/data.ts`);
  } else {
    console.log('No high-confidence matches with new lyrics. Nothing patched.');
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
