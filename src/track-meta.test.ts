import { describe, expect, it } from 'vitest';
import { ALBUMS, TRACKS } from './data';
import { SEO_INDEX, albumSeo, buildSeoIndex, trackOgImage, trackSeo, type RouteSeo } from './track-meta';

const SITE_ORIGIN = 'https://music.megabyte.space';

describe('trackOgImage', () => {
  it('returns the canonical per-track OG path', () => {
    expect(trackOgImage('birch-swing-heaven')).toBe(`${SITE_ORIGIN}/og/track-birch-swing-heaven.jpg`);
  });
});

describe('trackSeo', () => {
  it('throws when the track references an unknown album', () => {
    const phantom = { ...TRACKS[0], album: 'no-such-album', id: 'phantom-track' };
    expect(() => trackSeo(phantom)).toThrow(/No album for track phantom-track/);
  });

  it('produces canonical paths anchored to SITE_ORIGIN', () => {
    const seo = trackSeo(TRACKS[0]);
    expect(seo.canonical.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
    expect(seo.path.startsWith('/')).toBe(true);
    expect(seo.canonical).toBe(`${SITE_ORIGIN}${seo.path}`);
  });

  it('emits track-shaped embed (480x160) and music.song OG type', () => {
    const seo = trackSeo(TRACKS[0]);
    expect(seo.ogType).toBe('music.song');
    expect(seo.embedWidth).toBe(480);
    expect(seo.embedHeight).toBe(160);
    expect(seo.audioType).toBe('audio/mpeg');
    expect(seo.audioUrl?.startsWith(SITE_ORIGIN)).toBe(true);
  });

  it('encodes the canonical URL into the oEmbed query', () => {
    const seo = trackSeo(TRACKS[0]);
    expect(seo.oembedUrl).toContain('/api/oembed?url=');
    expect(seo.oembedUrl).toContain(encodeURIComponent(seo.canonical));
  });
});

describe('albumSeo', () => {
  it('emits album-shaped embed (480x240) and music.album OG type', () => {
    const seo = albumSeo(ALBUMS[0]);
    expect(seo.ogType).toBe('music.album');
    expect(seo.embedWidth).toBe(480);
    expect(seo.embedHeight).toBe(240);
    expect(seo.path).toBe(`/${ALBUMS[0].id}`);
  });
});

describe('SEO contract (every route)', () => {
  const routes: Array<{ kind: 'track' | 'album'; seo: RouteSeo }> = [
    ...TRACKS.map(t => ({ kind: 'track' as const, seo: trackSeo(t) })),
    ...ALBUMS.map(a => ({ kind: 'album' as const, seo: albumSeo(a) }))
  ];

  it.each(routes)('$kind $seo.path title is 50-60 chars', ({ seo }) => {
    expect(seo.title.length).toBeGreaterThanOrEqual(50);
    expect(seo.title.length).toBeLessThanOrEqual(60);
  });

  it.each(routes)('$kind $seo.path description is 120-156 chars', ({ seo }) => {
    expect(seo.description.length).toBeGreaterThanOrEqual(120);
    expect(seo.description.length).toBeLessThanOrEqual(156);
  });

  it.each(routes)('$kind $seo.path has at least one JSON-LD entry', ({ seo }) => {
    expect(Array.isArray(seo.jsonLd)).toBe(true);
    expect(seo.jsonLd.length).toBeGreaterThanOrEqual(1);
  });

  it.each(routes)('$kind $seo.path canonical is absolute https', ({ seo }) => {
    expect(seo.canonical).toMatch(/^https:\/\/music\.megabyte\.space\//);
  });

  it.each(routes)('$kind $seo.path og/twitter share fields are non-empty', ({ seo }) => {
    expect(seo.ogTitle).toBeTruthy();
    expect(seo.ogDescription).toBeTruthy();
    expect(seo.ogImage).toMatch(/^https:\/\//);
    expect(seo.ogImageAlt).toBeTruthy();
    expect(seo.twitterTitle).toBeTruthy();
    expect(seo.twitterDescription).toBeTruthy();
    expect(seo.twitterImage).toMatch(/^https:\/\//);
  });

  it.each(routes)('$kind $seo.path seoBody is 300-1000 words', ({ seo }) => {
    const words = seo.seoBody
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(300);
    expect(words).toBeLessThanOrEqual(1000);
  });
});

describe('SEO_INDEX uniqueness', () => {
  const entries = Object.values(SEO_INDEX);

  it('has one entry per album + per track (+ content pages)', () => {
    // SEO_INDEX = albums + tracks + the 6 static content pages
    // (about/credits/press/merch/privacy/terms) added in buildSeoIndex.
    const CONTENT_PAGE_COUNT = 6;
    expect(entries.length).toBe(ALBUMS.length + TRACKS.length + CONTENT_PAGE_COUNT);
  });

  it('keys every entry by a leading-slash path matching seo.path', () => {
    for (const [key, seo] of Object.entries(SEO_INDEX)) {
      expect(key.startsWith('/')).toBe(true);
      expect(key).toBe(seo.path);
    }
  });

  it('produces unique titles across every route (case-insensitive)', () => {
    const seen = new Map<string, string>();
    for (const seo of entries) {
      const norm = seo.title.toLowerCase().trim();
      const prev = seen.get(norm);
      expect(prev, `duplicate title "${seo.title}" on ${seo.path} and ${prev}`).toBeUndefined();
      seen.set(norm, seo.path);
    }
  });

  it('produces unique descriptions across every route (case-insensitive)', () => {
    const seen = new Map<string, string>();
    for (const seo of entries) {
      const norm = seo.description.toLowerCase().trim();
      const prev = seen.get(norm);
      expect(prev, `duplicate description on ${seo.path} and ${prev}`).toBeUndefined();
      seen.set(norm, seo.path);
    }
  });

  it('rebuilds deterministically (buildSeoIndex matches the exported const)', () => {
    const fresh = buildSeoIndex();
    expect(Object.keys(fresh).sort()).toEqual(Object.keys(SEO_INDEX).sort());
    for (const path of Object.keys(fresh)) {
      expect(fresh[path].title).toBe(SEO_INDEX[path].title);
      expect(fresh[path].description).toBe(SEO_INDEX[path].description);
    }
  });
});
