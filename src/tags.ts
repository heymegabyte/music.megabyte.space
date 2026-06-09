/**
 * Semantic tagger — derives mood, theme, place, genre, and identifier tags
 * for every track from its vibe + lyrics + album + wisdom. Memoized per track.
 */
import { TRACKS, ALBUM_BY_ID } from './data';
import type { Track } from './types';

export interface TrackTags {
  trackId: string;
  album: string;
  moods: string[];
  themes: string[];
  places: string[];
  genres: string[];
  energy: 'low' | 'mid' | 'high';
  tempo: 'slow' | 'medium' | 'fast';
  contains: string[];
  identifiers: { slug: string; albumSlug: string; hash: string; bpmHint: number };
}

const MOOD_RULES: Array<[RegExp, string]> = [
  [/holy|sacred|psalm|prayer|hymn|gospel|saint|halo|crown|throne|christ|jesus|noah|matthew|jerusalem|creed/i, 'sacred'],
  [/mercy|grace|forgive|redeem|baptism|surrender|pardon/i, 'mercy'],
  [/dawn|sunrise|morning|first-light|sun-up/i, 'dawn'],
  [/night|midnight|moon|star|stars|sleep|dream/i, 'nocturnal'],
  [/dance|stew|stomp|march|parade|drum|rim|beat/i, 'kinetic'],
  [/quiet|silence|whisper|low-volume|hush|still/i, 'quiet'],
  [/triumph|win|elevation|elevator|lift|rise|launch/i, 'triumphant'],
  [/heartbreak|broken|cry|grief|tears|fallen/i, 'tender'],
  [/warning|alarm|millstone|wake|alert|fbi|brick/i, 'urgent'],
  [/discipline|focus|orient|compass|precise|study/i, 'disciplined'],
  [/love|beloved|wife|family|child|baby/i, 'loving']
];

const THEME_RULES: Array<[RegExp, string]> = [
  // no-substance = the project's clean-living ethos (CLAUDE.md: "Christian-
  // gangster, zero drug references"). Catches both literal sobriety language
  // and the redemption-from-the-old-life markers the catalog actually uses
  // ("brand new child", "clean plate, warm grace") so songs whose ethic is
  // sobriety-without-the-keyword still tag.
  [/no drug|no vice|no bottle|no needle|sober|stay(?:ed)? clean|clean plate|brand new child|discipline|virtue/i, 'no-substance'],
  [/greene|law \d|forty-eight|48 laws/i, 'greene-law'],
  [/soup|kitchen|plate|bread|feed|meal|stew|bean/i, 'soup-kitchen'],
  [/ai|artificial|silicon|model|engine|crown of ai/i, 'ai'],
  [/america|usa|federal|fed|cbo|debt|empire|nation/i, 'civic'],
  [/family|wife|son|daughter|mama|father|kin/i, 'family'],
  [/migration|border|checkpoint|paperwork-saint|kabul|afghanistan/i, 'migration'],
  [/christ|jesus|messiah|cross|resurrection|gospel|psalm/i, 'christian'],
  [/panda|cyan|crown|brand-mark|mikewell/i, 'brand'],
  [/bay-area|saint john|newark|jersey|kabul|atlantis|bermuda|jerusalem/i, 'place-named'],
  [/elevator|elevation|stop higher|one floor|launch/i, 'ascent'],
  [/water|tide|sea|river|crossfire|atlantis|leviathan|slipstream/i, 'water']
];

const PLACE_RULES: Array<[RegExp, string]> = [
  [/bay[- ]area|oakland|sf|san francisco/i, 'bay-area'],
  [/saint john|st\.? john|st-john/i, 'saint-johns'],
  [/newark|jersey|brick city/i, 'newark'],
  [/kabul|afghanistan/i, 'kabul'],
  [/jerusalem/i, 'jerusalem'],
  [/atlantis/i, 'atlantis'],
  [/bermuda/i, 'bermuda'],
  [/border|checkpoint|paperwork/i, 'border'],
  [/heaven|sky|cloud|stars|cosmos|galaxy/i, 'celestial'],
  [/kitchen|table|window|home/i, 'domestic']
];

const GENRE_RULES: Array<[RegExp, string]> = [
  [/dance|stromae|stomp|drum-machine|rimshot|parade/i, 'electronic'],
  [/hymn|psalm|gospel|halo|crown|throne/i, 'gospel'],
  [/trap|sling|slingshot|grip|brick|chrome/i, 'trap'],
  [/folk|kettle|hobbit|shire|kitchen|herb/i, 'folk'],
  [/ambient|silence|low-volume|exhale|breathe|window/i, 'ambient'],
  [/orchestral|symphony|leviathan|atlantis/i, 'cinematic']
];

const ENERGY_KEYS = ['quiet', 'still', 'whisper', 'low-volume', 'silence', 'exhale', 'humble', 'humility'];
const HIGH_KEYS = ['stomp', 'launch', 'rimshot', 'parade', 'march', 'dance', 'elevator', 'trillion', 'crossfire'];

function applyRules<T extends string>(rules: Array<[RegExp, T]>, text: string): T[] {
  const out = new Set<T>();
  for (const [re, tag] of rules) if (re.test(text)) out.add(tag);
  return [...out];
}

function energyOf(text: string): 'low' | 'mid' | 'high' {
  const t = text.toLowerCase();
  const low = ENERGY_KEYS.filter(k => t.includes(k)).length;
  const high = HIGH_KEYS.filter(k => t.includes(k)).length;
  if (high > low && high >= 2) return 'high';
  if (low > high && low >= 2) return 'low';
  return 'mid';
}

function tempoOf(energy: 'low' | 'mid' | 'high'): 'slow' | 'medium' | 'fast' {
  if (energy === 'low') return 'slow';
  if (energy === 'high') return 'fast';
  return 'medium';
}

function bpmHint(energy: 'low' | 'mid' | 'high', genres: string[]): number {
  const baseline = energy === 'low' ? 72 : energy === 'high' ? 128 : 96;
  if (genres.includes('trap')) return Math.max(baseline, 140);
  if (genres.includes('electronic')) return Math.max(baseline, 120);
  if (genres.includes('ambient')) return Math.min(baseline, 72);
  return baseline;
}

function hashOf(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function deriveTags(track: Track): TrackTags {
  const album = ALBUM_BY_ID.get(track.album);
  const body = [
    track.title,
    track.vibe,
    track.lyrics.join(' '),
    track.wisdom,
    album?.name ?? '',
    album?.tagline ?? '',
    album?.description ?? ''
  ].join(' ');
  const moods = applyRules(MOOD_RULES, body);
  const themes = applyRules(THEME_RULES, body);
  const places = applyRules(PLACE_RULES, body);
  const genres = applyRules(GENRE_RULES, body);
  const energy = energyOf(body);
  const tempo = tempoOf(energy);
  const contains: string[] = [];
  if (/panda/i.test(body)) contains.push('panda');
  if (/cyan/i.test(body)) contains.push('cyan');
  if (/greene/i.test(track.wisdom)) contains.push('greene-wisdom');
  if (track.lyrics.length >= 4) contains.push('full-lyrics');
  return {
    trackId: track.id,
    album: track.album,
    moods,
    themes,
    places,
    genres,
    energy,
    tempo,
    contains,
    identifiers: {
      slug: track.id,
      albumSlug: track.album,
      hash: hashOf(track.id),
      bpmHint: bpmHint(energy, genres)
    }
  };
}

/** Eagerly-derived tag map, keyed by `Track.id`. Built once at module load. */
export const TRACK_TAGS: Map<string, TrackTags> = new Map(TRACKS.map(t => [t.id, deriveTags(t)]));

/** Lookup the derived tags for a track. Returns `undefined` for unknown IDs. */
export function getTrackTags(trackId: string): TrackTags | undefined {
  return TRACK_TAGS.get(trackId);
}

/**
 * Find every track that matches `tag` in any of mood/theme/place/genre/contains.
 * Tag namespaces are not enforced — passing `'sacred'` matches the mood,
 * passing `'panda'` matches a `contains` flag. Order matches `TRACKS`.
 */
export function tracksByTag(tag: string): string[] {
  const hits: string[] = [];
  for (const [id, t] of TRACK_TAGS) {
    if (t.moods.includes(tag) || t.themes.includes(tag) || t.places.includes(tag) || t.genres.includes(tag) || t.contains.includes(tag)) {
      hits.push(id);
    }
  }
  return hits;
}

/** Collect the union of derived tags across all tracks, partitioned by namespace. */
export function allTags(): { moods: Set<string>; themes: Set<string>; places: Set<string>; genres: Set<string> } {
  const moods = new Set<string>();
  const themes = new Set<string>();
  const places = new Set<string>();
  const genres = new Set<string>();
  for (const t of TRACK_TAGS.values()) {
    t.moods.forEach(m => moods.add(m));
    t.themes.forEach(m => themes.add(m));
    t.places.forEach(m => places.add(m));
    t.genres.forEach(m => genres.add(m));
  }
  return { moods, themes, places, genres };
}
