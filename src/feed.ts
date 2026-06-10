// RSS 2.0 + iTunes feed for the bZ catalog — served by the Worker at /feed.xml
// (+ /rss.xml). Lets the catalog be followed in RSS readers / podcast apps and
// gives "new drops" syndication. Built from the same TRACKS/ALBUMS data + the
// probed TRACK_DURATIONS (so itunes:duration is accurate).
import { ALBUMS, TRACK_BY_ID } from './data';
import { TRACK_DURATIONS, TRACK_BYTES } from './durations';

const SITE = 'https://music.megabyte.space';
const ARTIST = 'bZ';
const OWNER_EMAIL = 'hey@megabyte.space';

function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** ISO date (YYYY-MM-DD) → RFC-822 for RSS pubDate; offsetMin staggers items. */
function rfc822(dateStr: string | undefined, offsetMin = 0): string {
  const base = dateStr ? `${dateStr}T12:00:00Z` : '2026-01-01T12:00:00Z';
  const d = new Date(base);
  if (offsetMin) d.setUTCMinutes(d.getUTCMinutes() + offsetMin);
  return d.toUTCString();
}

/** Whole seconds → iTunes duration (H:MM:SS or M:SS). */
function itunesDuration(secs: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function buildRssFeed(origin: string = SITE): string {
  // Newest album first, so the feed reads as a "latest drops" timeline.
  const albums = [...ALBUMS].sort((a, b) => (b.releasedAt || '').localeCompare(a.releasedAt || ''));
  const items: string[] = [];
  for (const album of albums) {
    album.trackIds.forEach((tid, i) => {
      const t = TRACK_BY_ID.get(tid);
      if (!t) return;
      const url = `${origin}/${album.id}/${t.id}`;
      const secs = TRACK_DURATIONS[t.id] || 0;
      const desc = `${t.vibe}. ${t.wisdom}`.trim();
      items.push(
        `    <item>
      <title>${xml(t.title)} — ${xml(ARTIST)}</title>
      <link>${xml(url)}</link>
      <guid isPermaLink="true">${xml(url)}</guid>
      <description>${xml(desc)}</description>
      <pubDate>${rfc822(album.releasedAt, -i)}</pubDate>
      <enclosure url="${xml(origin + t.file)}" type="audio/mpeg" length="${TRACK_BYTES[t.id] || 0}" />
      <itunes:author>${xml(ARTIST)}</itunes:author>
      <itunes:summary>${xml(desc)}</itunes:summary>${
        secs ? `\n      <itunes:duration>${itunesDuration(secs)}</itunes:duration>` : ''
      }
      <itunes:image href="${xml(origin)}/og/track-${xml(t.id)}.jpg" />
    </item>`
      );
    });
  }
  const lastBuild = albums[0] ? rfc822(albums[0].releasedAt) : rfc822(undefined);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>bZ — hustle gospel</title>
    <link>${xml(origin)}/</link>
    <atom:link href="${xml(origin)}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Hard but holy. Christian-gangster hustle gospel by bZ — every drop, straight from music.megabyte.space.</description>
    <language>en-us</language>
    <copyright>© bZ / Megabyte Labs</copyright>
    <lastBuildDate>${lastBuild}</lastBuildDate>
    <image>
      <url>${xml(origin)}/og/album-desiiignare.jpg</url>
      <title>bZ — hustle gospel</title>
      <link>${xml(origin)}/</link>
    </image>
    <itunes:author>${ARTIST}</itunes:author>
    <itunes:summary>Hard but holy. Christian-gangster hustle gospel by bZ.</itunes:summary>
    <itunes:owner><itunes:name>${ARTIST}</itunes:name><itunes:email>${OWNER_EMAIL}</itunes:email></itunes:owner>
    <itunes:image href="${xml(origin)}/og/album-desiiignare.jpg" />
    <itunes:category text="Music" />
    <itunes:explicit>false</itunes:explicit>
${items.join('\n')}
  </channel>
</rss>`;
}
