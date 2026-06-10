import type { Album, Track } from './types';
import { ALBUMS, ALBUM_BY_ID, TRACKS, TRACK_BY_ID } from './data';
import { TRACK_DURATIONS } from './durations';

const SITE_ORIGIN = 'https://music.megabyte.space';
const ARTIST = 'bZ';

/** Whole seconds → ISO-8601 duration (e.g. 180 → "PT3M0S") for schema.org. */
function iso8601Duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `PT${m}M${s}S`;
}
// 48 KB branded 1200×630 card — not the 2.6 MB source PNG. Social scrapers
// (Twitter/Discord/Slack/iMessage) reject or truncate multi-MB OG images.
const FALLBACK_OG = '/og/album-desiiignare.jpg';

export interface RouteSeo {
  path: string;
  title: string;
  description: string;
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogType: 'website' | 'music.song' | 'music.album';
  ogImage: string;
  ogImageAlt: string;
  twitterTitle: string;
  twitterDescription: string;
  twitterImage: string;
  jsonLd: object[];
  /** Static HTML body — 300-1000 words of narrative copy, headings,
   * internal links, lyrics extract, wisdom blockquote. Crawler-readable
   * but rendered behind a <details> in the static asset so the visible
   * player UI is unaffected. Generators below clamp at ~900 words to
   * stay under the 1000-word ceiling. */
  seoBody: string;
  audioUrl?: string;
  audioType?: string;
  embedUrl?: string;
  embedWidth?: number;
  embedHeight?: number;
  oembedUrl?: string;
}

function clampLen(value: string, min: number, max: number, padder: string): string {
  let out = value.trim();
  if (out.length > max) out = out.slice(0, max - 1).trimEnd() + '…';
  while (out.length < min) {
    out = `${out} ${padder}`.trim();
    if (out.length > max) {
      out = out.slice(0, max - 1).trimEnd() + '…';
      break;
    }
  }
  return out;
}

function pickTitle(candidates: string[]): string {
  const inRange = candidates.find(c => c.length >= 50 && c.length <= 60);
  if (inRange) return inRange;
  const closest = candidates.reduce((best, c) => {
    const bestDist = Math.min(Math.abs(best.length - 55), 100);
    const cDist = Math.min(Math.abs(c.length - 55), 100);
    return cDist < bestDist ? c : best;
  }, candidates[0]);
  return clampLen(closest, 50, 60, '·');
}

export function trackOgImage(trackId: string): string {
  return `${SITE_ORIGIN}/og/track-${trackId}.jpg`;
}

function albumOgImage(album: Album): string {
  return `${SITE_ORIGIN}${album.cover}`;
}

function buildTrackTitle(track: Track, album: Album): string {
  return pickTitle([
    `${track.title} · bZ · Hustle gospel from ${album.name}`,
    `${track.title} · bZ · ${album.name} · hustle gospel`,
    `${track.title} — bZ · ${album.name} · hard but holy`,
    `${track.title} — bZ on ${album.name} · cyan-flag gospel`,
    `${track.title} · bZ · ${album.name}`,
    `${track.title} — bZ · cyan-flag hustle gospel`
  ]);
}

function buildAlbumTitle(album: Album): string {
  return pickTitle([
    `${album.name} — bZ · ${album.tagline}`,
    `${album.name} by bZ · ${album.tagline}`,
    `${album.name} · bZ · ${album.tagline} · hustle gospel`,
    `${album.name} — bZ · ${album.tagline} · hard but holy`,
    `${album.name} · bZ · cyan-flag hustle gospel album`
  ]);
}

function cleanQuotes(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function pickDescription(candidates: string[]): string {
  const inRange = candidates.find(c => c.length >= 120 && c.length <= 156);
  if (inRange) return inRange;
  const closest = candidates.reduce((best, c) => {
    const bestDist = Math.abs(best.length - 138);
    const cDist = Math.abs(c.length - 138);
    return cDist < bestDist ? c : best;
  }, candidates[0]);
  return clampLen(closest, 120, 156, 'bZ.');
}

function trackDescription(track: Track, album: Album): string {
  const firstLine = cleanQuotes(track.lyrics[0] || '').replace(/\.$/, '');
  const secondLine = cleanQuotes(track.lyrics[1] || '').replace(/\.$/, '');
  return pickDescription([
    `${track.title} by bZ on ${album.name}: "${firstLine}." ${album.tagline}.`,
    `bZ — ${track.title} (${album.name}). "${firstLine}." Hustle gospel, hard but holy.`,
    `${track.title} (bZ · ${album.name}): "${firstLine}." "${secondLine}."`,
    `${track.title} on ${album.name} by bZ. "${firstLine}." Cyan-flag hustle gospel.`,
    `bZ presents ${track.title} from ${album.name}: ${album.tagline}. "${firstLine}."`
  ]);
}

function albumDescription(album: Album): string {
  return pickDescription([
    `${album.name} by bZ. ${album.tagline}. ${album.description}`,
    `bZ — ${album.name}: ${album.tagline}. ${album.description}`,
    `${album.name} (${album.tagline}) — bZ. ${album.description}`,
    `${album.name} by bZ: ${album.description}`
  ]);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wordCount(html: string): number {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length;
}

function siblingTrackLinks(album: Album, excludeId?: string, limit = 6): string {
  const items = album.trackIds
    .map(id => TRACK_BY_ID.get(id))
    .filter((t): t is Track => !!t && t.id !== excludeId)
    .slice(0, limit)
    .map(t => `<a href="/${album.id}/${t.id}">${escapeHtml(t.title)}</a>`);
  return items.join(', ');
}

function siblingAlbumLinks(excludeId?: string, limit = 5): string {
  return ALBUMS.filter(a => a.id !== excludeId)
    .slice(0, limit)
    .map(a => `<a href="/${a.id}">${escapeHtml(a.name)}</a>`)
    .join(', ');
}

function buildTrackBody(track: Track, album: Album): string {
  const wisdom = cleanQuotes(track.wisdom).trim();
  const lyrics = track.lyrics.map(cleanQuotes).filter(Boolean);
  const stanza1 = lyrics.slice(0, 4).map(escapeHtml).join('<br/>');
  const stanza2 = lyrics.slice(4, 8).map(escapeHtml).join('<br/>');
  const stanza3 = lyrics.slice(8, 12).map(escapeHtml).join('<br/>');
  const albumTrackLinks = siblingTrackLinks(album, track.id, 6);
  const otherAlbumLinks = siblingAlbumLinks(album.id, 4);

  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(track.title)} — bZ</h1>`);
  parts.push(
    `<p>${escapeHtml(track.title)} is a ${escapeHtml(track.vibe)} cut from <a href="/${album.id}">${escapeHtml(album.name)}</a>, the ${escapeHtml(album.tagline.toLowerCase())} record by <a href="${SITE_ORIGIN}/">bZ</a>. The track lives in the album's ${escapeHtml(album.description)} Recorded as part of bZ's hustle-gospel catalog — hard but holy, Christian-gangster ethic, zero substance references.</p>`
  );
  parts.push(`<h2>What the song is about</h2>`);
  parts.push(
    `<p>The hook lands on the line "${escapeHtml(lyrics[0] || track.title)}." It plays like a ${escapeHtml(track.vibe)} sermon set to a drum machine — bZ's signature where the bar is the prayer and the prayer is the bar. The wisdom behind the track is short and sharp: <em>${escapeHtml(wisdom)}</em></p>`
  );
  if (stanza1) {
    parts.push(`<h2>Opening verse</h2>`);
    parts.push(`<blockquote>${stanza1}</blockquote>`);
  }
  parts.push(`<h2>How it fits on ${escapeHtml(album.name)}</h2>`);
  parts.push(
    `<p>${escapeHtml(track.title)} sits inside the ${escapeHtml(album.name)} sequence alongside ${albumTrackLinks || 'the rest of the record'}. The full album is built around one premise — ${escapeHtml(album.description)} Every track on it follows the same rule: lyrics carry weight, faith is louder than flex, and the beat keeps walking. The album dropped on ${escapeHtml(album.releasedAt || '2026')} and was written, produced, and engineered entirely by bZ in a single relentless build cycle.</p>`
  );
  if (stanza2) {
    parts.push(`<h2>Second verse</h2>`);
    parts.push(`<blockquote>${stanza2}</blockquote>`);
  }
  parts.push(`<h2>Listen and embed</h2>`);
  parts.push(
    `<p>Stream <a href="/${album.id}/${track.id}">${escapeHtml(track.title)}</a> directly in the browser. Every region of the homepage maps to a different track — click anywhere to play. The track can also be embedded into any page, blog, or social post via the <code>/embed/${album.id}/${track.id}</code> player; the iframe is responsive, plays cleanly inside Discord, Reddit, Notion, and any oEmbed-aware tool, and includes prev/next navigation across the full album playlist. Web Audio FFT visuals + word-by-word karaoke render on every supported device.</p>`
  );
  if (stanza3) {
    parts.push(`<h2>Third verse</h2>`);
    parts.push(`<blockquote>${stanza3}</blockquote>`);
  }
  parts.push(`<h2>More from bZ</h2>`);
  parts.push(
    `<p>Other records from the same catalog: ${otherAlbumLinks || ''}. Every album is part of one long arc — hustle gospel, soup-kitchen liturgy, cyan-flag prophecy. The full discography lives at <a href="${SITE_ORIGIN}/">music.megabyte.space</a>. New drops are mirrored to Spotify, Apple Music, YouTube Music, and Tidal via DistroKid as soon as each cut is mastered.</p>`
  );
  parts.push(`<h2>Credits</h2>`);
  parts.push(
    `<p>Written and performed by bZ. Produced with Suno + handwritten lyric direction. Visualizer + player engineered in TypeScript on Cloudflare Workers. All artwork generated and curated by bZ. Cover art for ${escapeHtml(album.name)}: <a href="${SITE_ORIGIN}${album.cover}">${escapeHtml(album.cover)}</a>.</p>`
  );

  let html = parts.join('\n');
  // Word-count guard: if a long-lyric track tips past 1000 words, trim the
  // tail credits + third verse to land back inside the 300-1000 band.
  while (wordCount(html) > 960 && /<h2>Third verse<\/h2>/.test(html)) {
    html = html.replace(/<h2>Third verse<\/h2>[\s\S]*?<\/blockquote>\n/, '');
  }
  while (wordCount(html) > 960 && /<h2>Credits<\/h2>/.test(html)) {
    html = html.replace(/<h2>Credits<\/h2>[\s\S]*?<\/p>\n?/, '');
  }
  return html;
}

function buildAlbumBody(album: Album): string {
  const tracks = album.trackIds.map(id => TRACK_BY_ID.get(id)).filter((t): t is Track => !!t);
  const trackList = tracks
    .map(
      (t, i) =>
        `<li><a href="/${album.id}/${t.id}">${i + 1}. ${escapeHtml(t.title)}</a> — ${escapeHtml(t.vibe)}</li>`
    )
    .join('');
  const sampleWisdom = tracks
    .slice(0, 4)
    .map(t => `<li>${escapeHtml(t.title)}: <em>${escapeHtml(cleanQuotes(t.wisdom))}</em></li>`)
    .join('');
  const otherAlbumLinks = siblingAlbumLinks(album.id, 5);

  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(album.name)} — bZ</h1>`);
  parts.push(
    `<p><strong>${escapeHtml(album.tagline)}.</strong> ${escapeHtml(album.description)} Released ${escapeHtml(album.releasedAt || '2026')} by <a href="${SITE_ORIGIN}/">bZ</a> on the Megabyte Labs music imprint. The record collects ${tracks.length} hustle-gospel cuts written, produced, and engineered in one relentless build cycle — hard but holy, Christian-gangster ethic, zero substance references, every bar earned.</p>`
  );
  parts.push(`<h2>The premise</h2>`);
  parts.push(
    `<p>${escapeHtml(album.name)} is built around the idea that the prayer and the punchline can share a bar. The album was written entirely without industry pressure — no label notes, no A&R, no committee — and assembled track by track on a personal music engine that visualizes Web Audio FFT data in real time and renders word-by-word karaoke synced to the master vocal. Every song on the record can be streamed directly from the browser, cast to a TV via Chromecast, controlled via the OS-level Now Playing widget on macOS / iOS / Android, and embedded into any blog or social platform via a responsive iframe at <code>/embed/${album.id}</code>.</p>`
  );
  parts.push(`<h2>Tracklist</h2>`);
  parts.push(`<ol>${trackList}</ol>`);
  parts.push(`<h2>Wisdom from the record</h2>`);
  parts.push(`<ul>${sampleWisdom}</ul>`);
  parts.push(`<h2>How to listen</h2>`);
  parts.push(
    `<p>The fastest path: <a href="${SITE_ORIGIN}/">open the homepage</a> and click anywhere — every region of the screen maps to a different track from the bZ catalog. From the album page at <a href="/${album.id}">/${album.id}</a> the full playlist is one tap away on mobile and one click on desktop. The album is also distributed on Spotify, Apple Music, YouTube Music, and Tidal via DistroKid — search "bZ ${escapeHtml(album.name)}" on any of those platforms. To share a single track on Discord, Reddit, Notion, or Slack, paste the canonical URL <code>${escapeHtml(SITE_ORIGIN)}/${album.id}/&lt;track-id&gt;</code> and the platform's oEmbed handshake renders the in-line player automatically.</p>`
  );
  parts.push(`<h2>More from bZ</h2>`);
  parts.push(
    `<p>The full discography: ${otherAlbumLinks || ''}. Each record is a separate movement in a longer arc — soup-kitchen liturgy, cyan-flag prophecy, hobbit-kettle parables, federal-reserve trash, Atlantis crossfire. Subscribe via the homepage CTA to get every new drop in inbox + push notification the moment it masters out.</p>`
  );
  parts.push(`<h2>Credits</h2>`);
  parts.push(
    `<p>Written and performed by bZ. Produced with Suno + handwritten lyric direction. Visualizer + player engineered in TypeScript on Cloudflare Workers. Distribution via DistroKid (Spotify, Apple Music, YouTube Music, Tidal). All artwork generated and curated by bZ. Album cover: <a href="${SITE_ORIGIN}${album.cover}">${escapeHtml(album.cover)}</a>.</p>`
  );

  let html = parts.join('\n');
  while (wordCount(html) > 960 && /<h2>Credits<\/h2>/.test(html)) {
    html = html.replace(/<h2>Credits<\/h2>[\s\S]*?<\/p>\n?/, '');
  }
  return html;
}

function trackJsonLd(track: Track, album: Album, url: string): object[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'MusicRecording',
      name: track.title,
      url,
      image: trackOgImage(track.id),
      // Real probed duration (ffprobe → src/durations.ts); omit if unknown
      // rather than fabricate (was a hardcoded PT3M30S for every track).
      ...(TRACK_DURATIONS[track.id] ? { duration: iso8601Duration(TRACK_DURATIONS[track.id]) } : {}),
      audio: `${SITE_ORIGIN}${track.file}`,
      embedUrl: `${SITE_ORIGIN}/embed/${track.id}`,
      byArtist: { '@type': 'MusicGroup', name: ARTIST, url: SITE_ORIGIN },
      inAlbum: {
        '@type': 'MusicAlbum',
        name: album.name,
        url: `${SITE_ORIGIN}/${album.id}`,
        image: albumOgImage(album)
      },
      genre: 'Hustle gospel',
      // The recording's publish date = its album's release date (Google-
      // recommended MusicRecording field). Omitted when the album has no date.
      ...(album.releasedAt ? { datePublished: album.releasedAt } : {}),
      description: track.wisdom.replace(/[‘’“”]/g, '"')
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Music', item: SITE_ORIGIN },
        {
          '@type': 'ListItem',
          position: 2,
          name: album.name,
          item: `${SITE_ORIGIN}/${album.id}`
        },
        {
          '@type': 'ListItem',
          position: 3,
          name: track.title,
          item: url
        }
      ]
    }
  ];
}

function albumJsonLd(album: Album, url: string): object[] {
  const tracks = album.trackIds.map(id => TRACK_BY_ID.get(id)).filter((t): t is Track => Boolean(t));
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'MusicAlbum',
      name: album.name,
      url,
      image: albumOgImage(album),
      datePublished: album.releasedAt,
      byArtist: { '@type': 'MusicGroup', name: ARTIST, url: SITE_ORIGIN },
      description: album.description,
      numTracks: tracks.length,
      track: tracks.map((t, idx) => ({
        '@type': 'MusicRecording',
        position: idx + 1,
        name: t.title,
        url: `${SITE_ORIGIN}/${album.id}/${t.id}`
      }))
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Music', item: SITE_ORIGIN },
        { '@type': 'ListItem', position: 2, name: album.name, item: url }
      ]
    }
  ];
}

export function trackSeo(track: Track): RouteSeo {
  const album = ALBUM_BY_ID.get(track.album);
  if (!album) throw new Error(`No album for track ${track.id}`);
  const path = `/${album.id}/${track.id}`;
  const url = `${SITE_ORIGIN}${path}`;
  const title = buildTrackTitle(track, album);
  const description = trackDescription(track, album);
  const ogImage = trackOgImage(track.id);
  const audioUrl = `${SITE_ORIGIN}${track.file}`;
  const embedUrl = `${SITE_ORIGIN}/embed/${track.id}`;
  return {
    path,
    title,
    description,
    canonical: url,
    ogTitle: `${track.title} — bZ`,
    ogDescription: description,
    ogType: 'music.song',
    ogImage,
    ogImageAlt: `${track.title} — bZ · ${album.name} share card`,
    twitterTitle: `${track.title} — bZ`,
    twitterDescription: description,
    twitterImage: ogImage,
    jsonLd: trackJsonLd(track, album, url),
    seoBody: buildTrackBody(track, album),
    audioUrl,
    audioType: 'audio/mpeg',
    embedUrl,
    embedWidth: 480,
    embedHeight: 160,
    oembedUrl: `${SITE_ORIGIN}/api/oembed?url=${encodeURIComponent(url)}&format=json`
  };
}

export function albumSeo(album: Album): RouteSeo {
  const path = `/${album.id}`;
  const url = `${SITE_ORIGIN}${path}`;
  const title = buildAlbumTitle(album);
  const description = albumDescription(album);
  const ogImage = albumOgImage(album);
  const embedUrl = `${SITE_ORIGIN}/embed/${album.id}`;
  return {
    path,
    title,
    description,
    canonical: url,
    ogTitle: `${album.name} — bZ`,
    ogDescription: description,
    ogType: 'music.album',
    ogImage,
    ogImageAlt: `${album.name} — bZ album cover`,
    twitterTitle: `${album.name} — bZ`,
    twitterDescription: description,
    twitterImage: ogImage,
    jsonLd: albumJsonLd(album, url),
    seoBody: buildAlbumBody(album),
    embedUrl,
    embedWidth: 480,
    // Album embed renders a full tracklist below the transport — taller card.
    embedHeight: 240,
    oembedUrl: `${SITE_ORIGIN}/api/oembed?url=${encodeURIComponent(url)}&format=json`
  };
}

// Server-rendered SEO for the content pages (About / Tracks / Press / Merch /
// Privacy / Terms). Mirrors the metaTitle/metaDescription in content-pages.ts —
// kept as a small static list here so the worker's MetaRewriter rewrites the
// <head> at the edge (without importing the heavy content-pages render bundle).
// Without this, every content route served the homepage <title> to crawlers.
const CONTENT_PAGES_SEO: Array<{ slug: string; title: string; description: string; og: string }> = [
  {
    slug: 'about',
    title: 'About bZ — Newark hustle-gospel artist, theology, process',
    description:
      'Brian Zalewski is bZ — solo hustle-gospel artist out of Newark, NJ. Bio, hard-but-holy theology, the 5-stage song-making process, how to support the studio, and how to connect.',
    og: '/og/og-about.jpg'
  },
  {
    slug: 'credits',
    title: 'Tracks — per-track Suno DNA, BPM/key sources, licensing',
    description:
      'Every bZ track’s provenance: Suno model + style prompt, measured BPM + key, lyric-alignment method, and licensing. Full transparency on how each song was made.',
    og: FALLBACK_OG
  },
  {
    slug: 'press',
    title: 'Press — bios, cover art, brand voice, booking + embeds',
    description:
      '50-word + 150-word bios, hi-res cover art for every album, headshot, brand voice, booking + licensing, interview answers, and a live embed-player preview. Everything writers and curators need.',
    og: FALLBACK_OG
  },
  {
    slug: 'merch',
    title: 'Merch — bZ FREE SATAN apparel suite (Printful)',
    description:
      'The full FREE SATAN — It’s Animal Abuse apparel suite: Comfort Colors heavyweight tees, hoodies, long-sleeves, tanks. DTG print, Stripe checkout, ships worldwide via Printful.',
    og: '/merch/mockups/tee-1717-pepper.png'
  },
  {
    slug: 'privacy',
    title: 'Privacy — music.megabyte.space',
    description:
      'How music.megabyte.space handles data: anonymous play/share counts, opt-in newsletter, Stripe checkout, privacy-aware analytics. No accounts, no ad trackers, no sale of data.',
    og: FALLBACK_OG
  },
  {
    slug: 'terms',
    title: 'Terms of Service — music.megabyte.space',
    description:
      'Plain-English terms: stream freely for personal use, music + lyrics are © Brian Zalewski, merch via Stripe + Printful, licensing on request, no warranties.',
    og: FALLBACK_OG
  }
];

function contentPageSeo(c: { slug: string; title: string; description: string; og: string }): RouteSeo {
  const path = `/${c.slug}`;
  const url = `${SITE_ORIGIN}${path}`;
  const title = clampLen(c.title, 30, 60, ' — bZ');
  const description = clampLen(c.description, 120, 156, ' Hard but holy.');
  const ogImage = c.og.startsWith('http') ? c.og : `${SITE_ORIGIN}${c.og}`;
  return {
    path,
    title,
    description,
    canonical: url,
    ogTitle: title,
    ogDescription: description,
    ogType: 'website',
    ogImage,
    ogImageAlt: `${c.title} — bZ`,
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: ogImage,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: c.title,
        description,
        url,
        isPartOf: { '@type': 'WebSite', name: 'bZ — music.megabyte.space', url: SITE_ORIGIN }
      }
    ],
    seoBody: `<h1>${c.title}</h1><p>${description}</p><p><a href="/">bZ — music.megabyte.space</a></p>`
  };
}

export function buildSeoIndex(): Record<string, RouteSeo> {
  const map: Record<string, RouteSeo> = {};
  for (const album of ALBUMS) {
    const seo = albumSeo(album);
    map[seo.path] = seo;
  }
  for (const track of TRACKS) {
    const seo = trackSeo(track);
    map[seo.path] = seo;
  }
  for (const c of CONTENT_PAGES_SEO) {
    const seo = contentPageSeo(c);
    map[seo.path] = seo;
  }
  return map;
}

export const SEO_INDEX = buildSeoIndex();
export { FALLBACK_OG, SITE_ORIGIN };
