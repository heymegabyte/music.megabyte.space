import type { Album, Track } from './types';
import { ALBUMS, ALBUM_BY_ID, TRACKS, TRACK_BY_ID } from './data';

const SITE_ORIGIN = 'https://music.megabyte.space';
const ARTIST = 'bZ';
const FALLBACK_OG = '/art/cover-panda-desiiignare.png';

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
  return `${SITE_ORIGIN}/og/${trackId}.png`;
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

function trackJsonLd(track: Track, album: Album, url: string): object[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'MusicRecording',
      name: track.title,
      url,
      image: trackOgImage(track.id),
      duration: 'PT3M30S',
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
  const tracks = album.trackIds
    .map(id => TRACK_BY_ID.get(id))
    .filter((t): t is Track => Boolean(t));
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
    jsonLd: albumJsonLd(album, url)
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
  return map;
}

export const SEO_INDEX = buildSeoIndex();
export { FALLBACK_OG, SITE_ORIGIN };
