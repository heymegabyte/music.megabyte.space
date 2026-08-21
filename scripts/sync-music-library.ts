/**
 * sync-music-library.ts — mirror the albums hosted by music.megabyte.space
 * into ~/Music/bZ/<Album>/NN - Title.mp3, sorted by the site's tracklist order.
 *
 * Source of truth: src/data.ts (ALBUMS + TRACKS) + public/<track.file> (the exact
 * mp3s the site serves) + public/<album.cover> (album art). Idempotent: copies a
 * track only when absent or size-changed; trashes stale mp3s (renamed/removed
 * tracks) so each folder is an exact mirror; preserves any non-mp3 files.
 *
 *   npx vite-node scripts/sync-music-library.ts            # dry run (preview)
 *   npx vite-node scripts/sync-music-library.ts --apply    # write changes
 *
 * Dest overridable via MUSIC_DIR (default ~/Music/bZ).
 */
import { existsSync, mkdirSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, extname, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ALBUMS, TRACKS } from '../src/data';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = resolve(REPO, 'public');
const DEST_ROOT = process.env.MUSIC_DIR || resolve(homedir(), 'Music/bZ');
const APPLY = process.argv.includes('--apply');
const byId = new Map(TRACKS.map(t => [t.id, t] as const));

/** Strip filesystem-illegal chars; keep apostrophes/commas like the existing library. */
const sanitize = (s: string) => s.replace(/[/:]+/g, '-').replace(/\s+/g, ' ').trim();

let added = 0,
  updated = 0,
  kept = 0,
  staleTrashed = 0,
  coversAdded = 0;

function copyIfChanged(src: string, dest: string): 'added' | 'updated' | 'kept' {
  const exists = existsSync(dest);
  if (exists && statSync(dest).size === statSync(src).size) return 'kept';
  if (APPLY) copyFileSync(src, dest);
  return exists ? 'updated' : 'added';
}

function trash(path: string): void {
  if (APPLY) execFileSync('/usr/bin/trash', [path]);
}

for (const album of ALBUMS) {
  const dir = resolve(DEST_ROOT, sanitize(album.name));
  if (APPLY) mkdirSync(dir, { recursive: true });
  const expected = new Set<string>();
  const lines: string[] = [];

  // Album art → cover.<ext> + folder.<ext> (Finder/Music thumbnail conventions).
  const coverSrc = resolve(PUBLIC, album.cover.replace(/^\//, ''));
  if (existsSync(coverSrc)) {
    const ext = extname(coverSrc) || '.jpg';
    for (const name of [`cover${ext}`, `folder${ext}`]) {
      const dest = resolve(dir, name);
      if (!existsSync(dest)) {
        if (APPLY) copyFileSync(coverSrc, dest);
        coversAdded++;
      }
    }
  }

  album.trackIds.forEach((id, i) => {
    const t = byId.get(id);
    if (!t) {
      lines.push(`    ?? ${id} — not in TRACKS, skipped`);
      return;
    }
    const src = resolve(PUBLIC, t.file.replace(/^\//, ''));
    if (!existsSync(src)) {
      lines.push(`    !! ${id} — audio ${t.file} missing, skipped`);
      return;
    }
    const fname = `${String(i + 1).padStart(2, '0')} - ${sanitize(t.title)}.mp3`;
    expected.add(fname);
    const status = copyIfChanged(src, resolve(dir, fname));
    if (status === 'added') added++;
    else if (status === 'updated') updated++;
    else kept++;
    if (status !== 'kept') lines.push(`    ${status === 'added' ? '+' : '~'} ${fname}`);
  });

  // Trash stale mp3s (renamed/removed tracks) so the folder mirrors the site.
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.toLowerCase().endsWith('.mp3') && !expected.has(f)) {
        trash(resolve(dir, f));
        staleTrashed++;
        lines.push(`    - ${f}  (stale → trash)`);
      }
    }
  }

  const exists6 = ALBUMS.indexOf(album) < 6;
  console.log(`\n[${album.name}] ${album.trackIds.length} tracks${exists6 ? '' : '  (new album)'}`);
  console.log(lines.length ? lines.join('\n') : '    (up to date)');
}

console.log(
  `\n${APPLY ? 'APPLIED' : 'DRY RUN'}: +${added} added · ~${updated} updated · ${kept} unchanged · ${staleTrashed} stale trashed · ${coversAdded} cover files → ${DEST_ROOT}`
);
if (!APPLY) console.log('Re-run with --apply to write changes.');
