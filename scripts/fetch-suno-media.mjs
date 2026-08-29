#!/usr/bin/env node
/**
 * fetch-suno-media.mjs — download WAV + VIDEO for every track from Suno, but
 * ONLY for clips whose length matches the site MP3 (so we never pull a different
 * render than what the site actually plays). Self-cancelling: re-run freely; it
 * skips anything already present and exits 0 when nothing is left to fetch.
 *
 *   SUNO_COOKIE='<cookie>' node scripts/fetch-suno-media.mjs        # verify + download
 *   node scripts/fetch-suno-media.mjs                               # verify-only (no cookie)
 *   node scripts/fetch-suno-media.mjs --midi                        # also derive MIDI (basic-pitch)
 *
 * Cookie: paste the full document.cookie from an authenticated suno.com tab into
 * SUNO_COOKIE env or a gitignored `.suno-cookie` file. The `__session` JWT inside
 * is the Bearer token; the script refuses to call the API once it has expired.
 *
 * Length safeguard: a track is `verified` only when |siteSec − sunoSec| ≤ TOL.
 * `mismatch` clips are a different Suno render (e.g. chef-lu-stew 180s vs 203s)
 * and are NEVER downloaded — that would desync the WAV/video from the site audio.
 *
 * MIDI is NOT a Suno export; `--midi` shells out to `basic-pitch` (audio→MIDI)
 * against the local MP3 when that tool is installed, else records it as pending.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA_DIR = resolve(ROOT, 'public/media');
const MANIFEST = resolve(ROOT, 'data/suno-media-manifest.json');
const VIDEO_INDEX = resolve(MEDIA_DIR, 'index.json');
const TOL = 3; // seconds — same-render tolerance (durations.ts is whole seconds)
const WANT_MIDI = process.argv.includes('--midi');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';
const API = 'https://studio-api.prod.suno.com';

// ── inputs ──────────────────────────────────────────────────────────────────
const durSrc = readFileSync(resolve(ROOT, 'src/durations.ts'), 'utf8');
// Scope to the TRACK_DURATIONS block ONLY — the file also has a TRACK_BYTES map
// (file sizes), and a global regex would clobber durations with byte counts.
const durBlock = durSrc.match(/TRACK_DURATIONS[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!durBlock) throw new Error('TRACK_DURATIONS block not found in src/durations.ts');
const SITE_DUR = Object.fromEntries(
  [...durBlock[1].matchAll(/'([^']+)':\s*(\d+)/g)].map(m => [m[1], Number(m[2])])
);
const matches = JSON.parse(readFileSync(resolve(ROOT, 'data/suno-matches.json'), 'utf8')).matches || [];

// ── cookie / auth ─────────────────────────────────────────────────────────────
function readCookie() {
  if (process.env.SUNO_COOKIE) return process.env.SUNO_COOKIE.trim();
  const f = resolve(ROOT, '.suno-cookie');
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
}
function sessionToken(cookie) {
  const m = cookie.match(/(?:^|;\s*)__session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function jwtExp(tok) {
  try {
    const p = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString('utf8'));
    return typeof p.exp === 'number' ? p.exp : 0;
  } catch {
    return 0;
  }
}

const cookie = readCookie();
const token = sessionToken(cookie);
const exp = jwtExp(token);
const nowSec = Math.floor(Date.now() / 1000);
const authed = Boolean(token) && exp > nowSec + 30;
const authNote = !token
  ? 'no SUNO_COOKIE — verify-only'
  : exp <= nowSec
    ? `__session EXPIRED ${new Date(exp * 1000).toISOString()} — verify-only (mint a fresh cookie at https://suno.com)`
    : `authed (session valid until ${new Date(exp * 1000).toISOString()})`;

// ── classify every track by length ────────────────────────────────────────────
const rows = matches.map(m => {
  const siteSec = SITE_DUR[m.id];
  const sunoSec = Number(m.sunoDuration);
  const delta = siteSec != null && sunoSec ? Math.abs(siteSec - sunoSec) : null;
  const status =
    siteSec == null ? 'no-site-dur' : delta == null ? 'no-match' : delta <= TOL ? 'verified' : 'mismatch';
  return {
    id: m.id,
    album: m.album,
    sunoId: m.sunoId,
    siteSec,
    sunoSec: sunoSec ? +sunoSec.toFixed(1) : null,
    delta: delta != null ? +delta.toFixed(1) : null,
    status
  };
});
const verified = rows.filter(r => r.status === 'verified');
const mismatch = rows.filter(r => r.status === 'mismatch');

// ── download helpers ──────────────────────────────────────────────────────────
mkdirSync(MEDIA_DIR, { recursive: true });
const authHeaders = { 'User-Agent': UA, Authorization: `Bearer ${token}`, Accept: 'application/json' };

async function clipMeta(sunoId) {
  for (const path of [`/api/clip/${sunoId}`, `/api/gen/${sunoId}`]) {
    try {
      const r = await fetch(`${API}${path}`, { headers: authHeaders });
      if (r.ok) return await r.json();
    } catch {
      /* try next */
    }
  }
  return null;
}
async function downloadTo(url, dest) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
  await new Promise((res, rej) => {
    const ws = createWriteStream(dest);
    Readable.fromWeb(r.body).pipe(ws).on('finish', res).on('error', rej);
  });
  return statSync(dest).size;
}
function deriveMidi(id) {
  const mp3 = resolve(ROOT, 'public/audio', `${id}.mp3`);
  const out = resolve(MEDIA_DIR, `${id}.mid`);
  if (existsSync(out)) return 'have';
  if (!existsSync(mp3)) return 'no-audio';
  try {
    execFileSync('basic-pitch', [MEDIA_DIR, mp3, '--save-midi', '--no-sonify'], { stdio: 'ignore' });
    return existsSync(out) ? 'derived' : 'pending';
  } catch {
    return 'pending'; // basic-pitch not installed
  }
}

// ── run ───────────────────────────────────────────────────────────────────────
let dlWav = 0,
  dlVid = 0,
  dlMidi = 0,
  fail = 0;
const media = {};

for (const r of verified) {
  const wav = resolve(MEDIA_DIR, `${r.id}.wav`);
  const mp4 = resolve(MEDIA_DIR, `${r.id}.mp4`);
  const have = {
    wav: existsSync(wav),
    mp4: existsSync(mp4),
    mid: existsSync(resolve(MEDIA_DIR, `${r.id}.mid`))
  };

  if (authed && (!have.wav || !have.mp4)) {
    const meta = await clipMeta(r.sunoId);
    const videoUrl = meta?.video_url || meta?.metadata?.video_url;
    const wavUrl = meta?.wav_url || meta?.audio_url_wav || `${API}/api/gen/${r.sunoId}/wav_file/`;
    if (!have.mp4 && videoUrl) {
      try {
        await downloadTo(videoUrl, mp4);
        have.mp4 = true;
        dlVid++;
      } catch {
        fail++;
      }
    }
    if (!have.wav && wavUrl) {
      try {
        await downloadTo(wavUrl, wav);
        have.wav = true;
        dlWav++;
      } catch {
        fail++;
      }
    }
  }
  if (WANT_MIDI && !have.mid) {
    const res = deriveMidi(r.id);
    if (res === 'derived') {
      have.mid = true;
      dlMidi++;
    }
  }
  if (have.wav || have.mp4 || have.mid) media[r.id] = have;
}

// ── outputs ───────────────────────────────────────────────────────────────────
writeFileSync(
  MANIFEST,
  JSON.stringify(
    {
      generated_at: new Date(nowSec * 1000).toISOString(),
      tol_seconds: TOL,
      authed,
      counts: { total: rows.length, verified: verified.length, mismatch: mismatch.length },
      rows
    },
    null,
    2
  )
);
// index.json → the visualizer reads this to know which tracks have a playable video.
writeFileSync(VIDEO_INDEX, JSON.stringify(media, null, 0));

const remaining = authed
  ? verified.filter(
      r => !existsSync(resolve(MEDIA_DIR, `${r.id}.wav`)) || !existsSync(resolve(MEDIA_DIR, `${r.id}.mp4`))
    ).length
  : 0;
console.log(`\nSuno media — ${authNote}`);
console.log(
  `  length check: ${verified.length} verified · ${mismatch.length} mismatch (skipped — different render) · ${rows.length} total`
);
if (mismatch.length)
  console.log(
    `  mismatch e.g.: ${mismatch
      .slice(0, 4)
      .map(r => `${r.id}(${r.siteSec}s≠${r.sunoSec}s)`)
      .join(', ')}`
  );
if (authed)
  console.log(
    `  downloaded: ${dlVid} video · ${dlWav} wav${WANT_MIDI ? ` · ${dlMidi} midi` : ''}${fail ? ` · ${fail} failed` : ''} · ${remaining} still pending`
  );
else
  console.log(
    `  → provide a fresh SUNO_COOKIE to download WAV+VIDEO for the ${verified.length} verified tracks.`
  );
console.log(`  manifest → data/suno-media-manifest.json · video index → public/media/index.json`);

// Self-cancel signal: exit 0 when there is nothing left to fetch.
process.exit(0);
