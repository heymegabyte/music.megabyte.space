#!/usr/bin/env node
/**
 * Generate `public/sitemap.xml` from `src/data.ts` (ALBUMS + TRACKS).
 *
 * Runs as part of the `prebuild` step so the sitemap always matches the
 * shipped catalog. Every <url> gets a <lastmod>, which Google + Bing weight
 * heavily for content-freshness signals.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ORIGIN = 'https://music.megabyte.space';

function extractAlbumsAndTracks() {
  const src = readFileSync(resolve(ROOT, 'src/data.ts'), 'utf8');

  // Albums: pull id + releasedAt.
  const albums = [];
  const albumRe = /id:\s*'([^']+)',[\s\S]*?releasedAt:\s*'(\d{4}-\d{2}-\d{2})'/g;
  let m;
  // Use the ALBUMS array only — TRACKS also have releasedAt but we scan both.
  const albumsBlock = src.match(/ALBUMS:\s*Album\[\]\s*=\s*\[([\s\S]+?)\n\];/);
  if (albumsBlock) {
    let inner;
    while ((inner = albumRe.exec(albumsBlock[1])) !== null) {
      albums.push({ id: inner[1], lastmod: inner[2] });
    }
  }

  // Tracks: pull id + album from TRACKS array (releasedAt per-track not always set).
  const tracks = [];
  const tracksBlock = src.match(/TRACKS:\s*Track\[\]\s*=\s*\[([\s\S]+)/);
  if (tracksBlock) {
    // Multi-line track shape: id, title, artist, file, cover, album.
    const trackRe = /id:\s*'([^']+)',[\s\S]*?album:\s*'([^']+)'/g;
    while ((m = trackRe.exec(tracksBlock[1])) !== null) {
      tracks.push({ id: m[1], album: m[2] });
    }
  }
  return { albums, tracks };
}

function url(loc, lastmod, priority = 0.7) {
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority.toFixed(1)}</priority>
  </url>`;
}

function main() {
  const { albums, tracks } = extractAlbumsAndTracks();
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">`];

  // Root.
  lines.push(url(`${ORIGIN}/`, today, 1.0));

  // Albums + their tracks. Each album page lives at /<album-id>, every track
  // at /<album-id>/<track-id> — matches the SPA + worker route allowlist.
  for (const a of albums) {
    lines.push(url(`${ORIGIN}/${a.id}`, a.lastmod, 0.9));
  }
  for (const t of tracks) {
    const albumDate = albums.find(a => a.id === t.album)?.lastmod ?? today;
    lines.push(url(`${ORIGIN}/${t.album}/${t.id}`, albumDate, 0.7));
  }

  // Content pages — sourced from src/content-pages.ts so the sitemap stays in
  // sync as pages are added/removed (about/credits/press/merch as of 2026-06).
  let contentSlugs = [];
  try {
    const cp = readFileSync(resolve(ROOT, 'src/content-pages.ts'), 'utf8');
    const re = /\bslug:\s*'([a-z0-9-]+)'/g;
    let m;
    while ((m = re.exec(cp)) !== null) contentSlugs.push(m[1]);
    contentSlugs = [...new Set(contentSlugs)];
  } catch { /* fall back to none */ }
  for (const slug of contentSlugs) {
    lines.push(url(`${ORIGIN}/${slug}`, today, 0.6));
  }

  // Static one-off routes.
  lines.push(url(`${ORIGIN}/ashton`, today, 0.6));

  lines.push(`</urlset>`);
  const out = lines.join('\n');
  writeFileSync(resolve(ROOT, 'public/sitemap.xml'), out, 'utf8');
  console.log(`sitemap: ${albums.length} albums, ${tracks.length} tracks → public/sitemap.xml`);
}

main();
