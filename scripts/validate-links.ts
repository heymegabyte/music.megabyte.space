/**
 * validate-links.ts — dead-internal-link gate.
 *
 * Renders every content page (the Story-menu targets), the SSR SEO bodies,
 * and the app-shell HTML, then asserts every internal href/src resolves to a
 * real route (album, track, content page, worker route) or a real file under
 * public/. Exits 1 on any dead link so it can run in prebuild + CI.
 *
 * Run: npx vite-node scripts/validate-links.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALBUMS, TRACKS } from '../src/data';
import { CONTENT_PAGES } from '../src/content-pages';
import { SEO_INDEX } from '../src/track-meta';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = resolve(ROOT, 'public');

const albumIds = new Set(ALBUMS.map(a => a.id));
const trackById = new Map(TRACKS.map(t => [t.id, t] as const));
const contentSlugs = new Set(CONTENT_PAGES.map(p => p.slug));

/** Extension-less routes the worker/vite serve outside the album/track/page model. */
const SPECIAL_ROUTES = new Set(['/', '/ashton', '/cast-receiver', '/feed.xml', '/rss.xml', '/embed.html']);

/** A path with a file extension is treated as a static asset under public/. */
const ASSET_EXT =
  /\.(png|jpe?g|webp|avif|gif|svg|ico|json|xml|txt|mp3|mp4|webmanifest|lrc|m3u8|pdf|woff2?)$/i;

type Dead = { source: string; link: string; reason: string };
const dead: Dead[] = [];
let checked = 0;

function isValidPageRoute(clean: string): boolean {
  if (SPECIAL_ROUTES.has(clean)) return true;
  const seg = clean.split('/').filter(Boolean);
  if (seg.length === 1) return contentSlugs.has(seg[0]) || albumIds.has(seg[0]);
  if (seg.length === 2) {
    const [alb, trk] = seg;
    if (alb === 'embed') return albumIds.has(trk) || trackById.has(trk); // /embed/<album|track>
    if (alb === 'press' || alb === 'clip') return trackById.has(trk); // worker per-track kit/clip
    return albumIds.has(alb) && trackById.get(trk)?.album === alb; // /<album>/<track>
  }
  if (seg.length === 3 && seg[0] === 'embed') {
    const [, alb, trk] = seg;
    return albumIds.has(alb) && trackById.get(trk)?.album === alb; // /embed/<album>/<track>
  }
  return false;
}

function assetExists(clean: string): boolean {
  return existsSync(resolve(PUBLIC, `.${clean}`));
}

function checkLink(rawLink: string, source: string): void {
  // internal only: starts with a single '/', skip protocol-relative + externals
  if (!rawLink.startsWith('/') || rawLink.startsWith('//')) return;
  if (rawLink.includes('${')) return; // unresolved template fragment — skip
  if (rawLink.startsWith('/src/') || rawLink.startsWith('/@')) return; // vite dev-mode module entries
  const clean = rawLink.split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
  checked++;
  if (SPECIAL_ROUTES.has(clean)) return; // worker/vite routes that carry a file ext (feed.xml, embed.html)
  if (ASSET_EXT.test(clean)) {
    if (!assetExists(clean)) dead.push({ source, link: rawLink, reason: 'asset file missing in public/' });
    return;
  }
  if (!isValidPageRoute(clean)) dead.push({ source, link: rawLink, reason: 'no route resolves this path' });
}

function scanHtml(html: string, source: string): void {
  const re = /(?:href|src)="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) checkLink(m[1], source);
}

// 1. Content pages (Story-menu targets) — render + scan.
for (const page of CONTENT_PAGES) {
  scanHtml(page.render(), `content-page:${page.slug}`);
  if (page.ogImage) checkLink(page.ogImage, `content-page:${page.slug}(ogImage)`);
}

// 2. SSR SEO bodies + their canonical/og/embed/audio pointers.
for (const [path, seo] of Object.entries(SEO_INDEX)) {
  scanHtml(seo.seoBody, `seo-body:${path}`);
  for (const u of [seo.ogImage, seo.embedUrl, seo.audioUrl].filter(Boolean) as string[]) {
    checkLink(u.replace('https://music.megabyte.space', ''), `seo-meta:${path}`);
  }
}

// 3. App-shell static links (topbar Story menu, footer, dialogs) from main.ts + index.html.
for (const file of ['src/main.ts', 'index.html', 'embed.html']) {
  const p = resolve(ROOT, file);
  if (existsSync(p)) scanHtml(readFileSync(p, 'utf8'), file);
}

// 4. Worker-source anti-pattern: an href built as origin + a bare track-id var
// with no /<album> segment (e.g. `${origin}/${trackId}`) resolves to a bare
// slug that only the 301 rescue saves. The worker's renderPressPage shipped
// exactly this. Flag it so a track link is always canonical /<album>/<track>.
const workerSrc = resolve(ROOT, 'worker/index.ts');
if (existsSync(workerSrc)) {
  const src = readFileSync(workerSrc, 'utf8');
  const bareHref = /href="\$\{(?:origin|ORIGIN)\}\/\$\{(?:trackId|track\.id|t\.id)\}"/g;
  let m: RegExpExecArray | null;
  while ((m = bareHref.exec(src))) {
    checked++;
    dead.push({
      source: 'worker/index.ts',
      link: m[0],
      reason: 'bare track-slug href — use ${origin}/${album}/${trackId} (canonical)'
    });
  }
}

// Report.
const uniq = new Map<string, Dead>();
for (const d of dead) uniq.set(`${d.link}|${d.source}`, d);
const rows = [...uniq.values()].sort((a, b) => a.link.localeCompare(b.link));

console.log(
  `\nvalidate-links: checked ${checked} internal links across content pages, SEO bodies, and app shell.`
);
if (!rows.length) {
  console.log('✓ zero dead internal links.\n');
  process.exit(0);
}
console.error(`\n✗ ${rows.length} dead internal link(s):\n`);
for (const d of rows) console.error(`  ${d.link}\n    ↳ ${d.reason}  [${d.source}]`);
console.error('');
process.exit(1);
