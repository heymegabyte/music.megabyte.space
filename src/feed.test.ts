import { describe, it, expect } from 'vitest';
import { buildRssFeed } from './feed';
import { TRACKS } from './data';

describe('buildRssFeed', () => {
  const feed = buildRssFeed('https://music.megabyte.space');

  it('is a well-formed RSS 2.0 document with the iTunes namespace', () => {
    expect(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(feed).toContain('<rss version="2.0"');
    expect(feed).toContain('xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"');
    expect(feed).toContain('<channel>');
    expect(feed).toContain('</channel>');
    expect(feed.trimEnd().endsWith('</rss>')).toBe(true);
  });

  it('has one <item> per real track', () => {
    const itemCount = (feed.match(/<item>/g) || []).length;
    expect(itemCount).toBe(TRACKS.length);
  });

  it('emits a valid self-link, enclosure, and itunes:duration', () => {
    expect(feed).toContain('rel="self" type="application/rss+xml"');
    expect(feed).toContain('<enclosure url="https://music.megabyte.space/audio/');
    expect(feed).toMatch(/<itunes:duration>\d+:\d{2}/);
  });

  it('escapes XML special characters (no raw & < > in text nodes)', () => {
    // No bare ampersands that aren't entity references.
    expect(feed).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
  });
});
