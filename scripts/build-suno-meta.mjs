#!/usr/bin/env node
// Build src/suno-meta.ts — a typed map of full Suno provenance per track.
//
// Reads data/suno-matches.json (produced by fetch-suno-metadata.mjs) and
// emits a single TS module exporting `SUNO_META: Record<string, SunoMeta>`
// keyed by track id. Every track in src/data.ts that has a high-score
// Suno match (≥ 0.5) gets an entry. Tracks without a match are
// reported as warnings.
//
// Why a separate module:
//   - src/data.ts stays clean (one concern per file)
//   - the schema can evolve (new Suno fields, derived stats) without
//     touching every track literal
//   - lazy importable by UI components that need provenance (track credits,
//     debug panel, embed footer)
//   - regenerable in seconds from the cached suno-feed.json
//
// Usage: node scripts/build-suno-meta.mjs
// Run after `node scripts/fetch-suno-metadata.mjs` to refresh the cache.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MATCH_PATH = resolve(ROOT, 'data/suno-matches.json');
const FEED_PATH = resolve(ROOT, 'data/suno-feed.json');
const ANALYSIS_PATH = resolve(ROOT, 'data/audio-analysis.json');
const OUT_PATH = resolve(ROOT, 'src/suno-meta.ts');
const MIN_SCORE = 0.5;

if (!existsSync(MATCH_PATH) || !existsSync(FEED_PATH)) {
  console.error('Missing data/suno-matches.json or data/suno-feed.json — run scripts/fetch-suno-metadata.mjs first.');
  process.exit(1);
}

const matches = JSON.parse(await readFile(MATCH_PATH, 'utf8')).matches;
const clips = JSON.parse(await readFile(FEED_PATH, 'utf8')).clips;
const CLIP_BY_ID = new Map(clips.map(c => [c.id, c]));

// Audio analysis (BPM + key from ffmpeg + aubio + Krumhansl-Schmuckler).
// Optional — when missing we fall back to tag-regex extraction. When
// present, audio analysis wins because it's measured, not declared.
const analysis = existsSync(ANALYSIS_PATH)
  ? JSON.parse(await readFile(ANALYSIS_PATH, 'utf8')).tracks || {}
  : {};

// Trim/condense the long Suno tags string into a human-readable style line.
// Suno's `tags` often packs 18+ comma-segments — first 6 captures the genre
// + voice + tempo + 2-3 textures, which is what an album credits line needs.
function condenseTags(tags) {
  if (!tags) return '';
  return tags.split(/,\s*/).map(s => s.trim()).filter(Boolean).slice(0, 6).join(', ');
}

// Detect tempo. Suno tags often include "<N> BPM" or "<N>bpm" or "~<N> bpm".
// Returns null if no clear tempo found.
function extractBpm(tags) {
  if (!tags) return null;
  const m = tags.match(/(?:^|\s|~)(\d{2,3})\s*bpm/i);
  return m ? parseInt(m[1], 10) : null;
}

// Detect musical key if present in tags. Pattern: "C minor", "F# major",
// "Db minor", "f minor". Suno is inconsistent on case — we normalize to
// uppercase note + " " + lowercase quality.
function extractKey(tags) {
  if (!tags) return null;
  const m = tags.match(/\b([A-G][#b♯♭]?)\s*(minor|major|min|maj)\b/i);
  if (!m) return null;
  const note = m[1].toUpperCase().replace('♯', '#').replace('♭', 'b');
  const quality = /min/i.test(m[2]) ? 'minor' : 'major';
  return `${note} ${quality}`;
}

const entries = [];
const unmatched = [];

for (const m of matches) {
  if (m.score < MIN_SCORE || !m.sunoId) {
    unmatched.push(m.id);
    continue;
  }
  const clip = CLIP_BY_ID.get(m.sunoId);
  if (!clip) {
    unmatched.push(m.id);
    continue;
  }
  const meta = clip.metadata || {};
  const audio = analysis[m.id] || {};
  // Audio-analysis wins over tag-regex: measured BPM/key beats declared.
  // Keep the tag-derived value as a fallback when analysis is absent.
  const bpmTag = extractBpm(meta.tags);
  const keyTag = extractKey(meta.tags);
  const bpm = audio.bpm ?? bpmTag;
  const key = audio.key || keyTag;
  entries.push({
    id: m.id,
    sunoId: clip.id,
    sunoTitle: clip.title,
    sunoConcept: meta.gpt_description_prompt || null,
    sunoStyle: condenseTags(meta.tags),
    sunoStyleFull: meta.tags || '',
    sunoDisplayTags: clip.display_tags || '',
    sunoBpm: bpm ?? null,
    sunoBpmSource: audio.bpm ? 'audio' : (bpmTag ? 'tag' : null),
    sunoKey: key || null,
    sunoKeyConfidence: audio.keyConfidence ?? null,
    sunoKeySource: audio.key ? 'audio' : (keyTag ? 'tag' : null),
    sunoModel: clip.major_model_version || null,
    sunoModelName: clip.model_name || null,
    sunoDuration: typeof meta.duration === 'number' ? +meta.duration.toFixed(2) : null,
    sunoHasHook: !!clip.has_hook,
    sunoIsRemix: !!meta.is_remix,
    sunoIsInstrumental: !!meta.make_instrumental,
    sunoExplicit: !!clip.explicit,
    sunoCreatedAt: clip.created_at || null,
    sunoAudioUrl: clip.audio_url || null,
    sunoImageUrl: clip.image_large_url || clip.image_url || null,
    sunoVideoUrl: clip.video_url || null,
    sunoHandle: clip.handle || null,
    sunoUrl: `https://suno.com/song/${clip.id}`
  });
}

entries.sort((a, b) => a.id.localeCompare(b.id));

// Render the TS module. Pretty-printed for readability — gzip-friendly so
// no size win from compacting.
const lit = entries.map(e => {
  const lines = [
    `  '${e.id}': {`,
    `    sunoId: '${e.sunoId}',`,
    `    sunoTitle: ${tsString(e.sunoTitle)},`,
    `    sunoConcept: ${tsString(e.sunoConcept)},`,
    `    sunoStyle: ${tsString(e.sunoStyle)},`,
    `    sunoStyleFull: ${tsString(e.sunoStyleFull)},`,
    `    sunoDisplayTags: ${tsString(e.sunoDisplayTags)},`,
    `    sunoBpm: ${e.sunoBpm ?? 'null'},`,
    `    sunoBpmSource: ${tsString(e.sunoBpmSource)},`,
    `    sunoKey: ${tsString(e.sunoKey)},`,
    `    sunoKeyConfidence: ${e.sunoKeyConfidence ?? 'null'},`,
    `    sunoKeySource: ${tsString(e.sunoKeySource)},`,
    `    sunoModel: ${tsString(e.sunoModel)},`,
    `    sunoModelName: ${tsString(e.sunoModelName)},`,
    `    sunoDuration: ${e.sunoDuration ?? 'null'},`,
    `    sunoHasHook: ${e.sunoHasHook},`,
    `    sunoIsRemix: ${e.sunoIsRemix},`,
    `    sunoIsInstrumental: ${e.sunoIsInstrumental},`,
    `    sunoExplicit: ${e.sunoExplicit},`,
    `    sunoCreatedAt: ${tsString(e.sunoCreatedAt)},`,
    `    sunoAudioUrl: ${tsString(e.sunoAudioUrl)},`,
    `    sunoImageUrl: ${tsString(e.sunoImageUrl)},`,
    `    sunoVideoUrl: ${tsString(e.sunoVideoUrl)},`,
    `    sunoHandle: ${tsString(e.sunoHandle)},`,
    `    sunoUrl: '${e.sunoUrl}'`,
    `  }`
  ];
  return lines.join('\n');
}).join(',\n');

function tsString(v) {
  if (v === null || v === undefined) return 'null';
  return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

const header = `// AUTO-GENERATED by scripts/build-suno-meta.mjs — do not edit by hand.
//
// Full Suno provenance per track: source id, original title, style/BPM/key,
// generation model, CDN audio + image URLs, GPT concept prompt, etc.
// Use cases:
//   - track credits + "Generated with Suno {model}" footer
//   - fallback audio/cover when local /audio/<file> is missing
//   - debug panel ("View original on Suno")
//   - tempo-synced visualizer presets keyed on sunoBpm
//
// Regenerate with: node scripts/build-suno-meta.mjs (after a fresh
// scripts/fetch-suno-metadata.mjs run that refreshes data/suno-feed.json).

export interface SunoMeta {
  sunoId: string;
  sunoTitle: string;
  sunoConcept: string | null;
  sunoStyle: string;
  sunoStyleFull: string;
  sunoDisplayTags: string;
  sunoBpm: number | null;
  /** 'audio' = measured via aubio FFT beat tracker; 'tag' = parsed from
   *  Suno's style tags; null = neither source available. */
  sunoBpmSource: 'audio' | 'tag' | null;
  sunoKey: string | null;
  /** Krumhansl-Schmuckler Pearson correlation (0..1). null when source='tag'. */
  sunoKeyConfidence: number | null;
  sunoKeySource: 'audio' | 'tag' | null;
  sunoModel: string | null;
  sunoModelName: string | null;
  sunoDuration: number | null;
  sunoHasHook: boolean;
  sunoIsRemix: boolean;
  sunoIsInstrumental: boolean;
  sunoExplicit: boolean;
  sunoCreatedAt: string | null;
  sunoAudioUrl: string | null;
  sunoImageUrl: string | null;
  sunoVideoUrl: string | null;
  sunoHandle: string | null;
  sunoUrl: string;
}

export const SUNO_META: Record<string, SunoMeta> = {
`;

const footer = '\n};\n';

await writeFile(OUT_PATH, header + lit + footer, 'utf8');

console.log(`✓ Wrote ${entries.length} entries to src/suno-meta.ts (${(Buffer.byteLength(header + lit + footer) / 1024).toFixed(1)} KB)`);
if (unmatched.length) {
  console.log(`\n⚠ No Suno match for ${unmatched.length} track(s):`);
  for (const id of unmatched) console.log(`  - ${id}`);
} else {
  console.log('✓ Every track in src/data.ts has a Suno match.');
}

// Quick stats
const withBpm = entries.filter(e => e.sunoBpm).length;
const withKey = entries.filter(e => e.sunoKey).length;
const withConcept = entries.filter(e => e.sunoConcept).length;
const withImage = entries.filter(e => e.sunoImageUrl).length;
const modelHist = new Map();
for (const e of entries) {
  const m = e.sunoModel || 'unknown';
  modelHist.set(m, (modelHist.get(m) || 0) + 1);
}
console.log(`\nCoverage: BPM=${withBpm}/${entries.length}, Key=${withKey}/${entries.length}, Concept=${withConcept}/${entries.length}, Image=${withImage}/${entries.length}`);
console.log(`Models: ${[...modelHist].map(([k, v]) => `${k}(${v})`).join(', ')}`);
