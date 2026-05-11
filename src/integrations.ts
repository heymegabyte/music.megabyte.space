// Helper text for hooking up Spotify + YouTube Music auto-upload of every mp3.

export const SPOTIFY_INTEGRATION = `
Spotify will not let third-party apps directly upload mp3s to a public catalog. Distribution
is done through one of their preferred SPDs (DistroKid, TuneCore, CD Baby, Amuse, RouteNote).
We script around that:

1. Pick a distributor (DistroKid is fastest — 1–2 day Spotify turnaround).
2. Provision a service account, capture the API token at https://distrokid.com/integrations
   (DistroKid only exposes upload via their import API for label tier).
3. From the player, POST every track at /audio/*.mp3 to:
     POST https://api.distrokid.com/v3/uploads
     Authorization: Bearer DISTROKID_API_KEY
     multipart/form-data: file=<mp3>, metadata={title, artist:"bZ", album:"Panda Desiiignare", isrc, release_date}
4. After ingestion DistroKid pushes to Spotify in 24–48h.
5. Once live, capture the spotify:track:<id> URI and embed it in the now-playing card.

If you would rather use Spotify's own analytics/control surface for an artist already on the
platform, the Spotify Web API token at https://developer.spotify.com/dashboard authorizes
playlist + audio-features queries (NOT catalog uploads). Required scopes:
  user-modify-playback-state, playlist-modify-public, ugc-image-upload.
`;

export const YOUTUBE_MUSIC_INTEGRATION = `
YouTube Music ingests audio through YouTube itself (Content ID + Art Tracks):

1. Create an OAuth client at https://console.cloud.google.com/apis/credentials with
   YouTube Data API v3 enabled. Scope: https://www.googleapis.com/auth/youtube.upload
2. For each /audio/*.mp3, encode a static-image MP4 (ffmpeg loop=1 -i cover.png -i track.mp3 ...)
   so YouTube has video — Music ingest auto-promotes audio-only mp4 to an Art Track.
3. POST videos.insert with status=public, category=10 (Music), and a custom thumbnail.
4. Submit the channel for the YouTube Partner program → request "Topic" / Art Tracks linkage
   so the audio surfaces inside YouTube Music's catalog.
5. Required env: YOUTUBE_OAUTH_CLIENT_ID, YOUTUBE_OAUTH_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN.

End-to-end script (ready to ship):
  scripts/upload-spotify.mjs   # DistroKid uploads
  scripts/upload-youtube.mjs   # YouTube Data API v3 uploads + Art Track linking
`;

export const INTEGRATIONS_PAYLOAD = [
  { id: 'spotify', label: 'Spotify (via DistroKid)', body: SPOTIFY_INTEGRATION.trim() },
  { id: 'ytm', label: 'YouTube Music (via Data API)', body: YOUTUBE_MUSIC_INTEGRATION.trim() }
];
