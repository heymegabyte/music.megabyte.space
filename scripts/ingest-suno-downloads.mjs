#!/usr/bin/env node
/**
 * ingest-suno-downloads.mjs — the completion half of the Suno media loop. Scans
 * ~/Downloads for the files the Computer-Use flow pulls per song (WAV + video mp4
 * + stems/MIDI zip), matches each to a track by NORMALIZED TITLE, moves them into
 * public/media/, and flips that song's status in data/suno-download-queue.json.
 *
 *   node scripts/ingest-suno-downloads.mjs            # move matched files + update queue
 *   node scripts/ingest-suno-downloads.mjs --dry      # report only
 *
 * Suno download names are the song TITLE (e.g. "Soupe Saint-Jean.wav",
 * "Soupe Saint-Jean.mp4", "<Title> ... .zip" for the stems/MIDI bundle). Titles
 * are unique enough; on a tie the loop already picked the duration-matched clip.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync
} from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DL = resolve(homedir(), 'Downloads');
const MEDIA = resolve(ROOT, 'public/media');
const STEMS = resolve(MEDIA, 'stems');
const QF = resolve(ROOT, 'data/suno-download-queue.json');
const DRY = process.argv.includes('--dry');
const NO_R2 = process.argv.includes('--no-r2');
const R2_BUCKET = 'music-megabyte-space-media';
const CT = { wav: 'audio/wav', mp4: 'video/mp4', mid: 'audio/midi', zip: 'application/zip' };

const R2_ACCOUNT_ID = '84fa0d1b16ff8086dd958c468ce7fd59';
const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
// `wrangler r2 object put` hard-caps single uploads at 300 MiB; larger stems zips
// (6-min+ tracks) must go through the S3 multipart path instead.
const R2_PUT_LIMIT = 300 * 1024 * 1024;

/** Resolve an R2 S3 credential from env first, then the local get-secret store. */
function r2Secret(name) {
  if (process.env[name]) return process.env[name];
  try {
    return execFileSync('/Users/Apple/.local/bin/get-secret', [name], {
      encoding: 'utf8'
    }).trim();
  } catch {
    return '';
  }
}

/** Best-effort upload to R2 (the served store for ~14GB of media). Never fatal —
 *  the local public/media copy is the fallback; log + continue on failure.
 *  Files >300 MiB use the S3-compatible multipart path (aws CLI) since
 *  `wrangler r2 object put` refuses them. */
function uploadR2(localPath, key) {
  if (NO_R2 || DRY) return;
  const ext = extname(key).slice(1).toLowerCase();
  const ct = CT[ext] || 'application/octet-stream';
  let size = 0;
  try {
    size = statSync(localPath).size;
  } catch {
    /* fall through — let the upload attempt surface the error */
  }

  if (size > R2_PUT_LIMIT) {
    const ak = r2Secret('R2_ACCESS_KEY_ID');
    const sk = r2Secret('R2_SECRET_ACCESS_KEY');
    if (!ak || !sk) {
      console.log(
        `    ! R2 upload skipped for ${key} (>300 MiB, no R2 S3 creds — set R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY)`
      );
      return;
    }
    try {
      execFileSync(
        'aws',
        [
          's3',
          'cp',
          localPath,
          `s3://${R2_BUCKET}/${key}`,
          '--endpoint-url',
          R2_ENDPOINT,
          '--content-type',
          ct
        ],
        {
          cwd: ROOT,
          stdio: 'ignore',
          env: {
            ...process.env,
            AWS_ACCESS_KEY_ID: ak,
            AWS_SECRET_ACCESS_KEY: sk,
            AWS_DEFAULT_REGION: 'auto'
          }
        }
      );
      console.log(`    ↑ R2 ${key} (multipart)`);
    } catch {
      console.log(`    ! R2 multipart upload failed for ${key} (kept local)`);
    }
    return;
  }

  try {
    execFileSync(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        `${R2_BUCKET}/${key}`,
        '--remote',
        '--file',
        localPath,
        '--content-type',
        ct
      ],
      {
        cwd: ROOT,
        stdio: 'ignore',
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: R2_ACCOUNT_ID }
      }
    );
    console.log(`    ↑ R2 ${key}`);
  } catch {
    console.log(`    ! R2 upload failed for ${key} (kept local) — set CLOUDFLARE_API_KEY/EMAIL`);
  }
}

const norm = s =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]/g, '');
const q = JSON.parse(readFileSync(QF, 'utf8'));
// longest-title-first so "mama called us" wins over a substring collision
const byTitle = [...q.queue].sort((a, b) => b.title.length - a.title.length);

mkdirSync(STEMS, { recursive: true });
const files = existsSync(DL) ? readdirSync(DL).filter(f => /\.(wav|mp4|mid|midi|zip)$/i.test(f)) : [];
let moved = 0;
const touched = new Set();
for (const f of files) {
  const nf = norm(f);
  const hit = byTitle.find(t => nf.includes(norm(t.title)));
  if (!hit) continue;
  const ext = extname(f).toLowerCase().replace('.midi', '.mid');
  const isZip = ext === '.zip';
  const dest = isZip ? resolve(STEMS, `${hit.trackId}.zip`) : resolve(MEDIA, `${hit.trackId}${ext}`);
  console.log(
    `${DRY ? '[dry] ' : ''}${f}  →  ${dest.replace(ROOT + '/', '')}  (${(statSync(resolve(DL, f)).size / 1e6).toFixed(1)}MB)`
  );
  if (!DRY) renameSync(resolve(DL, f), dest);
  uploadR2(dest, isZip ? `stems/${hit.trackId}.zip` : `${hit.trackId}${ext}`);
  moved++;
  touched.add(hit.trackId);
}
// recompute each touched song's status from what's now present
for (const t of q.queue) {
  const wav = existsSync(resolve(MEDIA, `${t.trackId}.wav`));
  const mp4 = existsSync(resolve(MEDIA, `${t.trackId}.mp4`));
  const zip =
    existsSync(resolve(STEMS, `${t.trackId}.zip`)) || existsSync(resolve(MEDIA, `${t.trackId}.mid`));
  t.status =
    wav && mp4 && zip
      ? 'done'
      : wav || mp4 || zip
        ? `partial:${[wav && 'wav', zip && 'stems', mp4 && 'video'].filter(Boolean).join('+')}`
        : t.status;
}
if (!DRY) writeFileSync(QF, JSON.stringify(q, null, 2));
const done = q.queue.filter(t => t.status === 'done').length;
console.log(
  `\ningest: ${moved} files ${DRY ? 'would move' : 'moved'} · ${done}/${q.queue.length} songs complete (wav+stems+video)`
);
