export interface Track {
  id: string;
  title: string;
  artist: string;
  file: string;
  cover: string;
  album: string;
  vibe: string;
  zone: { row: number; col: number };
  lyrics: string[];
  wisdom: string;
}

/**
 * Distribution links per album. All optional — only set the ones with
 * confirmed URLs. The album header surfaces every present link in a
 * "Listen on" row so fans hop to their preferred platform in one tap.
 */
export interface AlbumLinks {
  spotify?: string;
  appleMusic?: string;
  youtubeMusic?: string;
  tidal?: string;
  amazonMusic?: string;
  bandcamp?: string;
  soundcloud?: string;
  /** DistroKid hyperfollow pre-save URL — pre-release marketing only. */
  preSave?: string;
}

export interface Album {
  id: string;
  name: string;
  cover: string;
  video?: string;
  tagline: string;
  description: string;
  accent: string;
  releasedAt?: string;
  trackIds: string[];
  /** External streaming + purchase URLs. */
  links?: AlbumLinks;
}

export interface PlayerState {
  trackId: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
}
