#!/usr/bin/env node
// Pull every clip + its metadata from your Suno account history and merge
// authoritative lyrics + style tags into src/data.ts.
//
// Modern Suno (May 2026) requires `Authorization: Bearer <__session>` —
// the cookie-only approach in the legacy fetch-suno-lyrics.mjs returns 401.
// This script:
//   1. Extracts the __session JWT from $SUNO_COOKIE (or accepts $SUNO_JWT)
//   2. Paginates studio-api.prod.suno.com/api/feed/v2 (page_size=50, max 40 pages)
//   3. Writes data/suno-feed.json (raw)
//   4. For each track in src/data.ts, picks best Suno clip via combined-score
//      (Jaccard on words + bonus for exact id match + bonus for prefix match)
//      against BOTH track.title AND track.id (Suno's original name lives in
//      the id, the display title is the renamed/curated form)
//   5. Writes data/suno-matches.json
//   6. With --merge: patches src/data.ts → lyrics[] (from clip.metadata.prompt
//      with [Verse]/[Chorus] markers stripped) + vibe (from clip.metadata.tags
//      first 5 comma-segments, only when current vibe is < 30 chars or absent)
//   7. With --realign: also re-runs realign-curated-words.mjs on every
//      patched track id so the public/lyrics/<id>.json timing JSON updates
//   8. Reports unmatched tracks at the end
//
// Cookie expiry: __session JWT lasts ~60min then refreshes via Clerk. If the
// 401 fires, paste a fresh cookie from suno.com/me → DevTools → Application.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const exec = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_PATH = resolve(ROOT, 'src/data.ts');
const FEED_OUT = resolve(ROOT, 'data/suno-feed.json');
const MATCH_OUT = resolve(ROOT, 'data/suno-matches.json');

const flags = new Set(process.argv.slice(2));
const doMerge = flags.has('--merge');
const doRealign = flags.has('--realign');
const dryRun = flags.has('--dry');
// --cached skips the network fetch when data/suno-feed.json already exists.
// Use when the cookie JWT has expired but the cached feed is still recent.
const useCached = flags.has('--cached');
const minScore = parseFloat(process.env.MIN_SCORE || '0.5');

const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function extractJwt() {
  if (process.env.SUNO_JWT) return process.env.SUNO_JWT.trim();
  const cookie = process.env.SUNO_COOKIE || '';
  if (!cookie) return '';
  // The __session cookie may appear twice (Clerk writes both __session and
  // __session_Jnxw-muT). Either works. Take the FIRST __session= we see.
  const m = cookie.match(/__session=([^;]+)/);
  return m ? m[1] : '';
}

const JWT = extractJwt();
if (!JWT && !useCached) {
  console.error('SUNO_COOKIE/SUNO_JWT missing. Paste cookie header from suno.com Network tab:');
  console.error('  export SUNO_COOKIE=\'<paste>\'');
  console.error('OR use --cached to skip the fetch and reuse data/suno-feed.json.');
  process.exit(2);
}

const baseHeaders = {
  'Authorization': `Bearer ${JWT}`,
  'User-Agent': REAL_UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://suno.com/',
  'Origin': 'https://suno.com'
};

async function fetchPage(page, attempt = 0) {
  const url = `https://studio-api.prod.suno.com/api/feed/v2?page=${page}&page_size=50`;
  const r = await fetch(url, { headers: baseHeaders });
  if (r.status === 401 || r.status === 403) {
    throw new Error(`Suno auth failed (${r.status}). Refresh SUNO_COOKIE from your browser (the __session JWT expires ~60min).`);
  }
  if (r.status === 429) {
    if (attempt >= 4) throw new Error(`Suno rate-limited on page ${page} after ${attempt} retries`);
    // Back-off: 4s, 8s, 16s, 32s — Suno's limit window is ~30s.
    const wait = 4000 * Math.pow(2, attempt);
    process.stderr.write(`\n  429 on page ${page} — backing off ${wait}ms (attempt ${attempt + 1}/4)\n`);
    await new Promise(r => setTimeout(r, wait));
    return fetchPage(page, attempt + 1);
  }
  if (!r.ok) throw new Error(`Suno feed ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function fetchAllClips() {
  const all = [];
  let prevTopId = null;
  // Suno feed/v2 page_size param is capped at 20 server-side as of May 2026,
  // and `num_total_results` is unreliable — drive pagination off `has_more`.
  // Hard ceiling of 200 pages keeps a misbehaving cursor from runaway.
  for (let page = 1; page <= 200; page++) {
    process.stderr.write(`  page ${page} (${all.length} clips so far)…\r`);
    const data = await fetchPage(page);
    const clips = Array.isArray(data?.clips) ? data.clips : Array.isArray(data) ? data : [];
    if (!clips.length) break;
    if (clips[0]?.id === prevTopId) break;
    prevTopId = clips[0]?.id;
    all.push(...clips);
    if (data?.has_more === false) break;
    // 1.2s pacing keeps us safely under Suno's ~20-req/30s feed limit.
    await new Promise(r => setTimeout(r, 1200));
  }
  process.stderr.write('\n');
  return all;
}

// --- Matching ----------------------------------------------------------------

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(s) {
  return new Set(normalize(s).split(' ').filter(Boolean));
}
function jaccard(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 0;
}

function idToWords(id) {
  return id.replace(/[-_]+/g, ' ').replace(/\b(st|saint)\b/g, 'st');
}

// Combined score: Jaccard against title + Jaccard against id-derived phrase,
// bonus for exact normalized match, bonus when Suno clip title starts with
// the track id phrase (common when Brian renamed for display polish).
function scoreClip(track, clip) {
  const clipTitleN = normalize(clip.title);
  const trackTitleN = normalize(track.title);
  const trackIdPhrase = normalize(idToWords(track.id));

  const jTitle = jaccard(track.title, clip.title);
  const jId = jaccard(trackIdPhrase, clipTitleN);
  // Substring-startsWith catches "Saint Johns Plate" vs "Saint John's Plate (v2)"
  const swTitle = clipTitleN.startsWith(trackTitleN) || trackTitleN.startsWith(clipTitleN) ? 0.25 : 0;
  const swId = clipTitleN.startsWith(trackIdPhrase) || trackIdPhrase.startsWith(clipTitleN) ? 0.2 : 0;
  const exact = clipTitleN === trackTitleN || clipTitleN === trackIdPhrase ? 0.35 : 0;

  return Math.min(1, Math.max(jTitle, jId) + swTitle + swId + exact);
}

function bestMatch(track, clips) {
  // Skip Suno generations that are incomplete (status !== 'complete') or
  // explicitly trashed — those are abandoned drafts, not the canonical version.
  const usable = clips.filter(c => c?.status === 'complete' && !c?.is_trashed);
  let best = null;
  for (const c of usable) {
    const s = scoreClip(track, c);
    if (!best || s > best.score) best = { clip: c, score: s };
  }
  return best;
}

// --- Lyric cleanup -----------------------------------------------------------

// Section-name single-words that Suno sometimes emits without brackets:
// `Hook` `Verse 1` `Chorus` `Pre-Chorus` `Refrain` `Intro` `Outro` etc.
// These are structural cues for Suno's model, not lyric content.
const SECTION_BARE_WORD = /^(hook|verse|chorus|bridge|pre[- ]?chorus|intro|outro|refrain|pre|post|interlude|drop|build|breakdown|tag)(\s*\d+)?$/i;

function cleanLyrics(prompt) {
  if (!prompt) return [];
  return prompt
    .split('\n')
    .map(l => l.trim())
    // Strip lines whose entire content is one or more [tag] groups —
    // catches both single `[Verse 1]` markers AND production-direction
    // stacks like `[Hook][gospel choir whisper][soft]` that Suno emits.
    // A real lyric line will have at least one non-bracket character
    // outside the brackets.
    .filter(l => l && !/^(?:\[[^\]]*\]\s*)+$/.test(l))
    // Also strip bare section-name lines like "Hook", "Verse 1", "OUTRO".
    .filter(l => !SECTION_BARE_WORD.test(l))
    .filter(l => l !== '...' && l !== '…');
}

function condenseTags(tags) {
  if (!tags) return '';
  const parts = tags.split(/,\s*/).map(s => s.trim()).filter(Boolean);
  // First 5 stylistic segments — captures genre + voice + tempo + 1-2 textures.
  return parts.slice(0, 5).join(', ');
}

// --- Track parsing -----------------------------------------------------------

function parseTracks(src) {
  const start = src.search(/export const TRACKS\s*:\s*Track\[\]\s*=\s*\[/);
  if (start < 0) return [];
  const region = src.slice(start);
  const blocks = region.match(/\{\s*id:\s*'[^']+'[\s\S]*?file:\s*'[^']+\.mp3'[\s\S]*?wisdom:[^\n]+\n\s*\}/g) || [];
  return blocks.map(b => ({
    block: b,
    id: b.match(/id:\s*'([^']+)'/)?.[1],
    title: b.match(/title:\s*'([^']+)'/)?.[1] || '',
    album: b.match(/album:\s*'([^']+)'/)?.[1] || '',
    file: b.match(/file:\s*'([^']+)'/)?.[1] || '',
    vibe: b.match(/vibe:\s*'([^']*)'/)?.[1] || ''
  })).filter(t => t.id);
}

// --- Main --------------------------------------------------------------------

async function main() {
  let clips;
  if (useCached) {
    if (!existsSync(FEED_OUT)) {
      console.error(`--cached requested but ${FEED_OUT} is missing — run without --cached first.`);
      process.exit(2);
    }
    const cached = JSON.parse(await readFile(FEED_OUT, 'utf8'));
    clips = cached.clips || [];
    process.stderr.write(`Using cached feed: ${clips.length} clips (fetched ${cached.fetched_at}).\n`);
  } else {
    process.stderr.write('Fetching Suno feed (paginated)…\n');
    clips = await fetchAllClips();
    process.stderr.write(`Got ${clips.length} clips.\n`);
    await mkdir(resolve(ROOT, 'data'), { recursive: true });
    await writeFile(FEED_OUT, JSON.stringify({ fetched_at: new Date().toISOString(), count: clips.length, clips }, null, 2));
    process.stderr.write(`Wrote ${FEED_OUT} (${(JSON.stringify(clips).length / 1024).toFixed(1)} KB)\n`);
  }

  const src = await readFile(DATA_PATH, 'utf8');
  const tracks = parseTracks(src);
  process.stderr.write(`Found ${tracks.length} tracks in src/data.ts\n\n`);

  const matches = [];
  for (const t of tracks) {
    const m = bestMatch(t, clips);
    matches.push({
      id: t.id,
      title: t.title,
      album: t.album,
      score: m?.score ?? 0,
      sunoId: m?.clip?.id ?? null,
      sunoTitle: m?.clip?.title ?? null,
      sunoTags: m?.clip?.metadata?.tags ?? null,
      sunoPrompt: m?.clip?.metadata?.prompt ?? null,
      sunoDuration: m?.clip?.metadata?.duration ?? null,
      sunoAudio: m?.clip?.audio_url ?? null,
      sunoImage: m?.clip?.image_large_url ?? m?.clip?.image_url ?? null,
      sunoCreated: m?.clip?.created_at ?? null
    });
  }
  await writeFile(MATCH_OUT, JSON.stringify({ generated_at: new Date().toISOString(), min_score: minScore, matches }, null, 2));
  process.stderr.write(`Wrote ${MATCH_OUT}\n\n`);

  // Report top + bottom
  const sorted = [...matches].sort((a, b) => b.score - a.score);
  console.log(`Top 15 matches (score ≥ ${minScore.toFixed(2)} required for merge):`);
  for (const m of sorted.slice(0, 15)) {
    const flag = m.score >= minScore ? '✓' : ' ';
    console.log(`  ${flag} ${m.score.toFixed(2)}  ${m.id.padEnd(28)} ← "${m.sunoTitle || '—'}"`);
  }

  const unmatched = sorted.filter(m => m.score < minScore);
  if (unmatched.length) {
    console.log(`\nBelow threshold (${unmatched.length}):`);
    for (const m of unmatched) {
      console.log(`  ✗ ${m.score.toFixed(2)}  ${m.id.padEnd(28)} (title: "${m.title}", best clip: "${m.sunoTitle || '—'}")`);
    }
  }

  if (!doMerge) {
    console.log('\nRun with --merge to patch src/data.ts. Add --realign to also rebuild timing JSON.');
    return;
  }

  // --- Patch src/data.ts ----------------------------------------------------
  let out = src;
  const patchedIds = [];
  const skipped = [];

  for (const m of matches) {
    if (m.score < minScore || !m.sunoPrompt) {
      skipped.push({ id: m.id, reason: m.score < minScore ? 'low score' : 'no prompt' });
      continue;
    }
    const lyrics = cleanLyrics(m.sunoPrompt);
    if (!lyrics.length) {
      skipped.push({ id: m.id, reason: 'empty lyrics after clean' });
      continue;
    }
    const tags = condenseTags(m.sunoTags);

    // Match the exact track block in src so we patch ONLY that one.
    const blockRe = new RegExp(
      `(\\{\\s*id:\\s*'${m.id}'[\\s\\S]*?lyrics:\\s*\\[)([\\s\\S]*?)(\\n\\s{4}\\])`
    );
    const lit = lyrics
      .map(l => `      '${l.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
      .join(',\n');
    const next = out.replace(blockRe, `$1\n${lit}\n    ]`);

    // Optional: refresh vibe with condensed Suno tags ONLY when the current
    // vibe is empty or generic (< 15 chars). Brian's curated vibes are
    // intentional poetry; don't overwrite them.
    let next2 = next;
    const trackBlockMatch = next.match(new RegExp(`\\{\\s*id:\\s*'${m.id}'[\\s\\S]*?wisdom:[^\\n]+\\n\\s*\\}`));
    if (tags && trackBlockMatch) {
      // Vibe regex must handle escaped apostrophes (e.g. `can\'t`) — naive
      // `[^']*` capture stops at the first inner `'` and reports a
      // misleading-short length, which triggered an unwanted overwrite.
      const currentVibe = trackBlockMatch[0].match(/vibe:\s*'((?:[^'\\]|\\.)*)'/)?.[1] || '';
      if (currentVibe.length < 15) {
        next2 = next.replace(
          new RegExp(`(\\{\\s*id:\\s*'${m.id}'[\\s\\S]*?vibe:\\s*')[^']*(')`),
          `$1${tags.replace(/'/g, "\\'")}$2`
        );
      }
    }

    if (next2 !== out) {
      out = next2;
      patchedIds.push(m.id);
    } else {
      skipped.push({ id: m.id, reason: 'block regex matched nothing — id may have special chars' });
    }
  }

  if (dryRun) {
    console.log(`\n[dry] would patch ${patchedIds.length} track(s): ${patchedIds.slice(0, 8).join(', ')}${patchedIds.length > 8 ? '…' : ''}`);
    console.log(`[dry] would skip ${skipped.length}`);
    return;
  }

  if (patchedIds.length) {
    await writeFile(DATA_PATH, out, 'utf8');
    console.log(`\n✓ Patched ${patchedIds.length} track(s) in src/data.ts`);
  } else {
    console.log('\n(no patches written)');
  }

  if (doRealign && patchedIds.length) {
    process.stderr.write(`\nRealigning timing JSON for ${patchedIds.length} track(s)…\n`);
    // Chunk to keep argv reasonable.
    const CHUNK = 20;
    for (let i = 0; i < patchedIds.length; i += CHUNK) {
      const slice = patchedIds.slice(i, i + CHUNK);
      try {
        const { stdout } = await exec('node', [resolve(__dirname, 'realign-curated-words.mjs'), ...slice], {
          maxBuffer: 4 * 1024 * 1024
        });
        process.stdout.write(stdout);
      } catch (err) {
        console.error(`Realign chunk failed: ${err.message}`);
      }
    }
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
