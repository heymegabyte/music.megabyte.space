import { describe, expect, it } from 'vitest';
import { TRACKS } from './data';
import { TRACK_TAGS, allTags, getTrackTags, tracksByTag } from './tags';

describe('TRACK_TAGS', () => {
  it('has an entry for every track in the catalog', () => {
    expect(TRACK_TAGS.size).toBe(TRACKS.length);
    for (const t of TRACKS) {
      expect(TRACK_TAGS.has(t.id)).toBe(true);
    }
  });

  it('shapes every entry with the expected namespaces', () => {
    for (const entry of TRACK_TAGS.values()) {
      expect(entry).toMatchObject({
        trackId: expect.any(String),
        album: expect.any(String),
        moods: expect.any(Array),
        themes: expect.any(Array),
        places: expect.any(Array),
        genres: expect.any(Array),
        contains: expect.any(Array),
        identifiers: {
          slug: expect.any(String),
          albumSlug: expect.any(String),
          hash: expect.any(String),
          bpmHint: expect.any(Number)
        }
      });
      expect(['low', 'mid', 'high']).toContain(entry.energy);
      expect(['slow', 'medium', 'fast']).toContain(entry.tempo);
    }
  });
});

describe('getTrackTags', () => {
  it('returns undefined for unknown IDs', () => {
    expect(getTrackTags('definitely-not-a-track')).toBeUndefined();
    expect(getTrackTags('')).toBeUndefined();
  });

  it('returns the precomputed entry for a known ID', () => {
    const sample = TRACKS[0];
    const tags = getTrackTags(sample.id);
    expect(tags).toBeDefined();
    expect(tags!.trackId).toBe(sample.id);
    expect(tags!.album).toBe(sample.album);
  });

  it('derives stable tags for the chef-lu-stew anchor track', () => {
    const tags = getTrackTags('chef-lu-stew');
    expect(tags).toBeDefined();
    expect(tags!.moods).toContain('sacred');
    expect(tags!.themes).toContain('soup-kitchen');
    expect(tags!.themes).toContain('no-substance');
    expect(tags!.places).toContain('bay-area');
    expect(tags!.contains).toContain('panda');
    expect(tags!.contains).toContain('greene-wisdom');
    expect(tags!.contains).toContain('full-lyrics');
  });

  it('matches tempo to energy', () => {
    for (const entry of TRACK_TAGS.values()) {
      if (entry.energy === 'low') expect(entry.tempo).toBe('slow');
      if (entry.energy === 'high') expect(entry.tempo).toBe('fast');
      if (entry.energy === 'mid') expect(entry.tempo).toBe('medium');
    }
  });
});

describe('tracksByTag', () => {
  it('returns [] for tags no track matches', () => {
    expect(tracksByTag('this-tag-does-not-exist')).toEqual([]);
  });

  it('matches across namespaces (moods/themes/places/genres/contains)', () => {
    expect(tracksByTag('sacred')).toContain('chef-lu-stew');
    expect(tracksByTag('soup-kitchen')).toContain('chef-lu-stew');
    expect(tracksByTag('bay-area')).toContain('chef-lu-stew');
    expect(tracksByTag('panda')).toContain('chef-lu-stew');
  });

  it('returns deduplicated track IDs', () => {
    const hits = tracksByTag('sacred');
    expect(new Set(hits).size).toBe(hits.length);
  });
});

describe('allTags', () => {
  it('returns a Set per namespace', () => {
    const t = allTags();
    expect(t.moods).toBeInstanceOf(Set);
    expect(t.themes).toBeInstanceOf(Set);
    expect(t.places).toBeInstanceOf(Set);
    expect(t.genres).toBeInstanceOf(Set);
  });

  it('partitions tags by namespace (no cross-pollution)', () => {
    const t = allTags();
    expect(t.moods.has('sacred')).toBe(true);
    expect(t.themes.has('soup-kitchen')).toBe(true);
    expect(t.places.has('bay-area')).toBe(true);
    expect(t.moods.has('soup-kitchen')).toBe(false);
    expect(t.themes.has('sacred')).toBe(false);
  });

  it('includes every namespace value that appears in TRACK_TAGS', () => {
    const t = allTags();
    for (const entry of TRACK_TAGS.values()) {
      entry.moods.forEach(m => expect(t.moods.has(m)).toBe(true));
      entry.themes.forEach(m => expect(t.themes.has(m)).toBe(true));
      entry.places.forEach(m => expect(t.places.has(m)).toBe(true));
      entry.genres.forEach(m => expect(t.genres.has(m)).toBe(true));
    }
  });
});
