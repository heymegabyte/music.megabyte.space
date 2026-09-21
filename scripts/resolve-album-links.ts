/**
 * resolve-album-links.ts — resolve REAL direct streaming URLs for each album.
 *
 * Spotify: queried by the KNOWN bZ artist id (no namesake risk — every result
 * is bZ's own release). Apple: iTunes Search API (free, no auth), verified by
 * matching BOTH artistName≈"bZ" AND the album title, so a different "bZ" can't
 * slip in. Prints a JSON map { albumId: { spotify?, appleMusic? } } to stdout.
 *
 * Run: SPOTIFY_CLIENT_ID=… SPOTIFY_CLIENT_SECRET=… npx vite-node scripts/resolve-album-links.ts
 */
import { ALBUMS, SPOTIFY_ARTIST_ID } from '../src/data';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

/** Normalize a title for tolerant matching (lowercase alphanumerics only). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’.,!?—–-]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function titleMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return x === y || x.includes(y) || y.includes(x);
}

async function spotifyToken(): Promise<string | null> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!r.ok) return null;
  return ((await r.json()) as { access_token?: string }).access_token ?? null;
}

async function spotifyAlbums(token: string): Promise<Array<{ name: string; url: string }>> {
  const out: Array<{ name: string; url: string }> = [];
  let next: string | null =
    `https://api.spotify.com/v1/artists/${SPOTIFY_ARTIST_ID}/albums?include_groups=album,single,compilation&market=US&limit=50`;
  while (next) {
    const r: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) break;
    const j = (await r.json()) as {
      items?: Array<{ name: string; external_urls?: { spotify?: string } }>;
      next?: string | null;
    };
    for (const it of j.items ?? []) {
      if (it.external_urls?.spotify) out.push({ name: it.name, url: it.external_urls.spotify });
    }
    next = j.next ?? null;
  }
  return out;
}

async function appleAlbum(name: string): Promise<string | null> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(`bZ ${name}`)}&entity=album&limit=15&country=US`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    results?: Array<{ artistName?: string; collectionName?: string; collectionViewUrl?: string }>;
  };
  for (const it of j.results ?? []) {
    const artistOk = norm(it.artistName ?? '') === 'bz';
    const titleOk = it.collectionName ? titleMatch(it.collectionName, name) : false;
    if (artistOk && titleOk && it.collectionViewUrl) {
      return it.collectionViewUrl.split('?')[0]; // strip ?uo= tracking
    }
  }
  return null;
}

async function main(): Promise<void> {
  const token = await spotifyToken();
  const spotify = token ? await spotifyAlbums(token) : [];
  process.stderr.write(`spotify: token=${token ? 'ok' : 'MISSING'}, ${spotify.length} releases listed\n`);

  const map: Record<string, { spotify?: string; appleMusic?: string }> = {};
  for (const album of ALBUMS) {
    const entry: { spotify?: string; appleMusic?: string } = {};
    const sp = spotify.find(a => titleMatch(a.name, album.name));
    if (sp) entry.spotify = sp.url;
    const ap = await appleAlbum(album.name);
    if (ap) entry.appleMusic = ap;
    if (entry.spotify || entry.appleMusic) map[album.id] = entry;
    process.stderr.write(
      `  ${album.id.padEnd(26)} spotify=${entry.spotify ? 'Y' : '-'} apple=${entry.appleMusic ? 'Y' : '-'}  (${album.name})\n`
    );
  }
  process.stdout.write(JSON.stringify(map, null, 2) + '\n');
}

main();
