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
}

export interface PlayerState {
  trackId: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
}
