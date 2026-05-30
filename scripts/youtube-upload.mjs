#!/usr/bin/env node
/**
 * YouTube auto-upload — pushes a track to YouTube as "Official Audio" with
 * the album cover as the static video frame.
 *
 * SETUP (one time):
 *   1. https://console.cloud.google.com/apis/library/youtube.googleapis.com
 *      → Enable YouTube Data API v3 on a Google Cloud project
 *   2. https://console.cloud.google.com/apis/credentials
 *      → Create OAuth client (Desktop app), download JSON
 *      → Save as ~/.local/secrets/YOUTUBE_OAUTH_CLIENT (just the
 *        `{"installed":{...}}` blob)
 *   3. Run: node scripts/youtube-upload.mjs auth
 *      → Opens browser, you grant scope, paste code → refresh_token saved to
 *        ~/.local/secrets/YOUTUBE_REFRESH_TOKEN
 *
 * USAGE:
 *   node scripts/youtube-upload.mjs upload chef-lu-stew
 *     → Renders a 1080×1080 still video from cover + audio via ffmpeg
 *     → Uploads as Unlisted, you flip to Public in Studio after review
 *   node scripts/youtube-upload.mjs upload chef-lu-stew --public
 *     → Goes straight to Public
 *
 * Requires: ffmpeg in PATH, OPENAI_API_KEY (for the lyric video description).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SECRETS = '/Users/Apple/.local/secrets';
const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

const [, , cmd, ...rest] = process.argv;
const flags = new Set(rest);
const args = rest.filter(a => !a.startsWith('--'));

function loadClient() {
  const p = `${SECRETS}/YOUTUBE_OAUTH_CLIENT`;
  if (!existsSync(p)) {
    console.error(`Missing ${p}. See setup at top of file.`);
    process.exit(2);
  }
  return JSON.parse(execSync(`cat ${p}`, { encoding: 'utf8' })).installed;
}

async function getAccessToken() {
  const client = loadClient();
  const refresh = execSync('/Users/Apple/.local/bin/get-secret YOUTUBE_REFRESH_TOKEN', { encoding: 'utf8' }).trim();
  if (!refresh || refresh.startsWith('The file')) throw new Error('No refresh token — run `auth` first');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.access_token;
}

async function authFlow() {
  const client = loadClient();
  const redirect = 'http://127.0.0.1:43219/callback';
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(client.client_id)}&redirect_uri=${encodeURIComponent(redirect)}&response_type=code&scope=${encodeURIComponent(SCOPE)}&access_type=offline&prompt=consent`;
  console.log('Opening browser…');
  spawnSync('open', [url]);
  const code = await new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const c = u.searchParams.get('code');
      res.end('OK — return to terminal.');
      if (c) { srv.close(); resolve(c); }
    });
    srv.listen(43219);
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  });
  const j = await r.json();
  if (!j.refresh_token) { console.error('No refresh_token returned. Did you previously grant? Revoke at https://myaccount.google.com/permissions and retry.'); process.exit(2); }
  await writeFile(`${SECRETS}/YOUTUBE_REFRESH_TOKEN`, j.refresh_token + '\n');
  await execSync(`chmod 600 ${SECRETS}/YOUTUBE_REFRESH_TOKEN`);
  console.log('✓ Refresh token saved');
}

async function ensureVideoFile(trackId) {
  const audio = resolve(ROOT, 'public/audio', `${trackId}.mp3`);
  const cover = resolve(ROOT, 'public/art', `cover-${trackId}.jpg`);
  if (!existsSync(audio)) throw new Error(`Missing ${audio}`);
  const coverPath = existsSync(cover) ? cover : resolve(ROOT, 'public/art/cover-panda-desiiignare.jpg');
  await mkdir('/tmp/yt-renders', { recursive: true });
  const out = `/tmp/yt-renders/${trackId}.mp4`;
  if (existsSync(out)) return out;
  // ffmpeg: stretch 1080x1080 still to full audio duration, copy audio, encode H.264
  const cmd = `ffmpeg -y -loop 1 -i "${coverPath}" -i "${audio}" -c:v libx264 -tune stillimage -preset veryfast -crf 22 -c:a aac -b:a 192k -shortest -vf "scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080" -pix_fmt yuv420p "${out}"`;
  console.log('  rendering MP4…');
  execSync(cmd, { stdio: 'inherit' });
  return out;
}

function loadTrackMeta(trackId) {
  const dataPath = resolve(ROOT, 'src/data.ts');
  const src = execSync(`cat ${dataPath}`, { encoding: 'utf8' });
  const block = src.match(new RegExp(`\\{\\s*id:\\s*['"]${trackId}['"][\\s\\S]*?wisdom:[^\\n]+\\n\\s*\\}`));
  if (!block) throw new Error(`Track not found: ${trackId}`);
  const title = block[0].match(/title:\s*['"]([^'"]+)['"]/)?.[1] || trackId;
  const album = block[0].match(/album:\s*['"]([^'"]+)['"]/)?.[1] || '';
  const vibe = block[0].match(/vibe:\s*['"]([^'"]+)['"]/)?.[1] || '';
  return { title, album, vibe };
}

async function upload(trackId) {
  const meta = loadTrackMeta(trackId);
  const video = await ensureVideoFile(trackId);
  const token = await getAccessToken();
  const isPublic = flags.has('--public');
  const buf = await readFile(video);

  const body = {
    snippet: {
      title: `${meta.title} — bZ (Official Audio)`,
      description: `"${meta.title}" by bZ\n\n${meta.vibe}\n\nFrom ${meta.album} · 2026\nStream: https://music.megabyte.space/${trackId}\nPress kit: https://music.megabyte.space/press/${trackId}\nSpotify: https://open.spotify.com/artist/0hDEUhE0QAh51cM1Fe2p3T\n\n#hustlegospel #christianhiphop #newark #bzmusic`,
      tags: ['bZ', 'hustle gospel', 'Christian hip-hop', 'Newark', 'Megabyte Labs', meta.album].filter(Boolean),
      categoryId: '10', // Music
      defaultLanguage: 'en',
    },
    status: {
      privacyStatus: isPublic ? 'public' : 'unlisted',
      embeddable: true,
      license: 'youtube',
      madeForKids: false,
    },
  };

  // Step 1: create resumable upload session
  const init = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'video/mp4',
        'X-Upload-Content-Length': String(buf.length),
      },
      body: JSON.stringify(body),
    }
  );
  if (!init.ok) { console.error('init failed', init.status, await init.text()); process.exit(2); }
  const uploadUrl = init.headers.get('Location');

  // Step 2: PUT video bytes
  console.log(`  uploading ${(buf.length / 1024 / 1024).toFixed(1)} MB…`);
  const up = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length) },
    body: buf,
  });
  if (!up.ok) { console.error('upload failed', up.status, await up.text()); process.exit(2); }
  const result = await up.json();
  const ytUrl = `https://youtu.be/${result.id}`;
  console.log(`✓ Published ${isPublic ? 'PUBLIC' : 'UNLISTED'}: ${ytUrl}`);
  console.log(`  Studio: https://studio.youtube.com/video/${result.id}/edit`);
}

if (cmd === 'auth') await authFlow();
else if (cmd === 'upload') {
  if (!args[0]) { console.error('Usage: upload <trackId> [--public]'); process.exit(2); }
  await upload(args[0]);
} else {
  console.log(`youtube-upload — bZ release pipeline

Commands:
  auth                       One-time OAuth setup (opens browser)
  upload <trackId>           Upload as Unlisted (default)
  upload <trackId> --public  Publish immediately

Required secrets: YOUTUBE_OAUTH_CLIENT (file), YOUTUBE_REFRESH_TOKEN (after auth)
Required CLI: ffmpeg`);
}
