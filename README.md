<!-- README generated 2026-05-30 -->
<div align="center">
  <a href="https://music.megabyte.space">
    <img width="240" alt="bZ logo" src="public/art/bz-icon.png" />
  </a>
</div>
<div align="center">
  <h1 align="center">bZ Music — hustle-gospel, live Web Audio</h1>
  <h4 align="center" style="color:#00E5FF;">A one-person stack for releasing music: SPA player · Web Audio visualizers · AI DJ · Whisper-aligned karaoke · auto press kits</h4>
  <h4 align="center"><a href="https://megabyte.space" target="_blank">Maintained by Megabyte Labs</a></h4>
</div>

<div align="center">
  <a href="https://music.megabyte.space" target="_blank">
    <img alt="Live" src="https://img.shields.io/website?down_color=%23FF4136&down_message=Down&label=music.megabyte.space&logo=cloudflare&logoColor=white&up_color=%2300E5FF&up_message=Live&url=https%3A%2F%2Fmusic.megabyte.space&style=for-the-badge" />
  </a>
  <a href="https://open.spotify.com/artist/0hDEUhE0QAh51cM1Fe2p3T" target="_blank">
    <img alt="Spotify" src="https://img.shields.io/badge/Spotify-Listen-1DB954?logo=spotify&logoColor=white&style=for-the-badge" />
  </a>
  <a href="LICENSE" target="_blank">
    <img alt="MIT" src="https://img.shields.io/badge/License-MIT-00E5FF?style=for-the-badge" />
  </a>
  <a href="https://github.com/HeyMegabyte/bzmusic" target="_blank">
    <img alt="GitHub" src="https://img.shields.io/badge/Source-GitHub-333333?logo=github&style=for-the-badge" />
  </a>
</div>

<br/>

> <h4 align="center"><strong>What one person + AI can ship in 2026 — a complete music release platform end-to-end, fully self-hosted on the Cloudflare edge.</strong></h4>

<br/>

<p align="center">
  <img src="docs/screenshots/home.png" width="100%" alt="bZ music — home view with live waveform visualizer" />
</p>

## Table of Contents

- [Overview](#overview)
- [Live](#live)
- [Visualizers](#visualizers)
- [Per-page tour](#per-page-tour)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Stack](#stack)
- [Press kits — auto-generated](#press-kits--auto-generated)
- [TikTok-ready clips](#tiktok-ready-clips)
- [AI DJ chat](#ai-dj-chat)
- [Adding a new release](#adding-a-new-release)
- [Scripts](#scripts)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**bZ Music** is the production codebase behind [music.megabyte.space](https://music.megabyte.space) — the live website for hustle-gospel artist [bZ](https://open.spotify.com/artist/0hDEUhE0QAh51cM1Fe2p3T) (Brian Zalewski, Newark NJ). It's a vanilla TypeScript single-page app on Cloudflare Workers, designed to run an entire indie music career — playback, distribution, press, social — from a single repo with one operator.

What makes it different:

1. **Real Web Audio visualizers, not React canvases** — 16+ visualizer modes (starfield, wormhole, nebula, mirror-wave, plasma, …) driven by the actual FFT of the playing track. Beat detection from `AnalyserNode`, key estimation from KS algorithm, per-frame at 60 fps.
2. **Whisper-aligned karaoke** — every track ships per-word timestamps in `public/lyrics/<id>.json`, produced by OpenAI Whisper-1 + Needleman-Wunsch alignment against the source Suno lyrics. 94%+ average match rate.
3. **Auto-generated per-track press kits** at `/press/{trackId}` — cinematic cover backdrop, 30s preview button, drop-cap bio, related-tracks list, sync availability, print-ready. Send a journalist one URL.
4. **Vertical TikTok clips** at `/clip/{trackId}` — 9:16 viewport with synced karaoke + brand watermark, designed to be screen-recorded straight from iPhone Control Center.
5. **AI DJ chat** powered by Cloudflare Workers AI (Llama 3.3 70B) — knows the catalog, the current track, the page you're reading. Slash commands, persona switching, voice input, drag-drop attachments.
6. **No build server, no Docker, no CI complexity** — `npm run build && npx wrangler deploy` ships everything (worker + static SPA + audio + lyrics + manifests) in under 90 seconds.

<hr/>

## Live

<table>
  <tr>
    <td width="50%">
      <a href="https://music.megabyte.space"><img src="docs/screenshots/home.png" alt="Home — Aurora visualizer" /></a>
      <p align="center"><sub><a href="https://music.megabyte.space">music.megabyte.space</a> — home view</sub></p>
    </td>
    <td width="50%">
      <a href="https://music.megabyte.space/bootleg-from-tomorrow"><img src="docs/screenshots/album-bootleg.png" alt="Album page — Bootleg From Tomorrow" /></a>
      <p align="center"><sub><a href="https://music.megabyte.space/bootleg-from-tomorrow">Bootleg From Tomorrow</a> — album page</sub></p>
    </td>
  </tr>
</table>

<hr/>

## Visualizers

Every track is analyzed in real time and rendered through one of **16+ visualizer modes**. Each maps the FFT, beat detector, and per-band amplitude streams differently — same audio, wildly different visuals. Mode is per-session, picker accessible via the topbar HUD chip.

### Wave family

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/viz-wave.png" alt="Wave visualizer" /><p align="center"><sub><strong>Wave</strong> — the classic time-domain scope</sub></p></td>
    <td width="50%"><img src="docs/screenshots/viz-mirror-wave.png" alt="Mirror Wave visualizer" /><p align="center"><sub><strong>Mirror Wave</strong> — symmetrically reflected</sub></p></td>
  </tr>
</table>

### Cosmic family

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/viz-starfield.png" alt="Starfield" /><p align="center"><sub><strong>Starfield</strong></sub></p></td>
    <td width="33%"><img src="docs/screenshots/viz-galaxy.png" alt="Galaxy" /><p align="center"><sub><strong>Galaxy</strong></sub></p></td>
    <td width="33%"><img src="docs/screenshots/viz-supernova.png" alt="Supernova" /><p align="center"><sub><strong>Supernova</strong></sub></p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/viz-constellation.png" alt="Constellation" /><p align="center"><sub><strong>Constellation</strong></sub></p></td>
    <td><img src="docs/screenshots/viz-aurora.png" alt="Aurora" /><p align="center"><sub><strong>Aurora</strong></sub></p></td>
    <td><img src="docs/screenshots/viz-nebula.png" alt="Nebula" /><p align="center"><sub><strong>Nebula</strong></sub></p></td>
  </tr>
</table>

### Tunnel family

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/viz-wormhole.png" alt="Wormhole" /><p align="center"><sub><strong>Wormhole</strong> — perspective tunnel</sub></p></td>
    <td width="50%"><img src="docs/screenshots/viz-vortex.png" alt="Vortex" /><p align="center"><sub><strong>Vortex</strong> — accent-tinted spiral</sub></p></td>
  </tr>
</table>

### Geometric family

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/viz-monolith.png" alt="Monolith" /><p align="center"><sub><strong>Monolith</strong></sub></p></td>
    <td width="33%"><img src="docs/screenshots/viz-bars.png" alt="Bars" /><p align="center"><sub><strong>Bars</strong></sub></p></td>
    <td width="33%"><img src="docs/screenshots/viz-sunburst.png" alt="Sunburst" /><p align="center"><sub><strong>Sunburst</strong></sub></p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/viz-lissajous.png" alt="Lissajous" /><p align="center"><sub><strong>Lissajous</strong></sub></p></td>
    <td><img src="docs/screenshots/viz-kaleidoscope.png" alt="Kaleidoscope" /><p align="center"><sub><strong>Kaleidoscope</strong></sub></p></td>
    <td><img src="docs/screenshots/viz-plasma.png" alt="Plasma" /><p align="center"><sub><strong>Plasma</strong></sub></p></td>
  </tr>
</table>

<hr/>

## Per-page tour

### Content pages — `/about`, `/process`, `/theology`, `/credits`, `/press`, `/contact`, `/support`

Long-form pages live in a single non-modal dialog over the player, so audio keeps playing while you navigate. Drop-cap leads, framed figures, accent eyebrow pills, scroll-progress hairline, sticky chip-rail nav with **Home** button.

<p align="center">
  <img src="docs/screenshots/contentpage-about.png" width="80%" alt="About page" />
</p>

### Per-track press kit — `/press/{trackId}`

Auto-generated for every track in `src/data.ts`. Cinematic cover backdrop, sticky topnav (Home + Press kit + Play), drop-cap bio, 30s inline preview, **More from bZ** related-tracks list, lyric quote, print-ready.

<p align="center">
  <img src="docs/screenshots/press-kit-bootleg.png" width="80%" alt="Press kit — Bootleg From Tomorrow" />
</p>

### AI DJ chat

Slide-in panel triggered by `⌘K` or the floating FAB. Streaming via Workers AI Llama 3.3 70B. Persona switching, slash commands, drag-drop attach, voice input. Knows the catalog + the current track + whichever content page you're reading.

<p align="center">
  <img src="docs/screenshots/ai-chat.png" width="80%" alt="AI DJ chat" />
</p>

<hr/>

## Quick Start

```bash
git clone https://github.com/HeyMegabyte/bzmusic.git
cd bzmusic
npm install
npm run dev                # local dev server at http://localhost:5173
```

Deploy to Cloudflare:

```bash
npx wrangler login         # one-time
npm run build              # tsc → vite → embed bundle → og card regen → tracks manifest
npx wrangler deploy        # ships worker + static SPA + assets
```

Required Cloudflare account features:
- Workers (free tier OK)
- Workers AI (Llama 3.3 70B FP8-fast) — free tier OK for low traffic
- KV namespace named `COUNTERS`
- *(Optional)* Browser Rendering — used by `/clip` for automated MP4 capture
- *(Optional)* Workers Tracing — set `[observability] enabled = true` in `wrangler.toml`

<hr/>

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│  Cloudflare Worker  (worker/index.ts)                                 │
│  ├─ /                       → SPA shell (HTMLRewriter SEO swap)       │
│  ├─ /{album} /{album}/{tr}  → SPA shell (deep links + canonical)      │
│  ├─ /press/{trackId}        → server-rendered press kit HTML          │
│  ├─ /clip/{trackId}         → 9:16 TikTok-ready vertical page         │
│  ├─ /api/ai/chat            → Workers AI Llama (stream + non-stream)  │
│  ├─ /api/spotify/track      → Spotify search, KV-cached 24h           │
│  ├─ /api/spotify/artist     → followers + popularity, KV-cached 1h    │
│  ├─ /api/subscribe          → Listmonk subscriber add                 │
│  ├─ /api/push/*             → web-push subs + send (VAPID)            │
│  └─ /audio/*  /lyrics/*     → served via env.ASSETS                   │
│                                                                       │
│  Static SPA  (src/main.ts, src/visualizer.ts, src/audio.ts, ...)      │
│  ├─ AudioEngine             → 1 persistent <audio>, FFT @60fps        │
│  ├─ Visualizer              → 16+ modes driven by FFT + beat phase    │
│  ├─ AI Chat                 → SSE consumer, slash registry, widgets   │
│  ├─ Content pages           → non-modal dialog over player            │
│  └─ Topbar / transport      → home + chip-rail (story mode)           │
│                                                                       │
│  Data layer  (src/data.ts, src/suno-meta.ts, src/content-pages.ts)    │
│  ├─ ALBUMS  7 records       → cover, tagline, trackIds, accent        │
│  ├─ TRACKS  59 records      → title, file, vibe, lyrics, wisdom       │
│  └─ SUNO_META               → per-track sunoId, BPM, key, audioUrl    │
│                                                                       │
│  Tooling  (scripts/*.mjs)                                             │
│  ├─ fetch-suno-lyrics       → pull lyrics from suno.com /api/feed     │
│  ├─ align-whisper-lyrics    → OpenAI Whisper + Needleman-Wunsch       │
│  ├─ gen-og-cards            → DALL-E per-track unfurl cards           │
│  ├─ gen-tracks-manifest     → public/tracks.json (drives /press)      │
│  ├─ gen-sitemap             → sitemap.xml + robots.txt                │
│  ├─ build-favicon-set       → 14-variant favicon set                  │
│  └─ send-curator-outreach   → Resend-powered press-kit emails         │
└───────────────────────────────────────────────────────────────────────┘
```

<hr/>

## Stack

| Concern | Choice |
| --- | --- |
| Frontend | Vanilla TypeScript + Vite v6 — **no UI framework** |
| Runtime | Cloudflare Workers (edge), Wrangler v4 |
| State | KV `COUNTERS` (plays, shares, rate limits, push subs, listmonk cache) |
| Audio | Web Audio API · `AnalyserNode` FFT · Krumhansl-Schmuckler key detection |
| AI | Workers AI Llama 3.3 70B FP8-fast (chat) · 3.1 8B fallback |
| Lyrics sync | OpenAI Whisper-1 + Needleman-Wunsch alignment |
| Image gen | OpenAI gpt-image-1 (album covers, OG cards, content figures) |
| Email | Resend + Listmonk |
| Push | Web Push w/ VAPID |
| Cast | Chromecast default receiver + custom app `228565CB` |
| Tests | Playwright v1.59 E2E @ 6 breakpoints vs `PROD_URL` |

<hr/>

## Press kits — auto-generated

Every track in `src/data.ts` gets a `/press/{trackId}` URL with zero per-track configuration. The Worker renders the page server-side using the track title (slug → Title Case), looks up Spotify metadata on demand for the album art + duration + popularity, falls back to the local `/art/cover-{trackId}.jpg` if no Spotify match.

**Send to a curator:**
```
Hi [name],
bZ — Newark hustle-gospel. "Chef Lu Stew" is a 2:59 cinematic gospel-trap cut.

Press kit:  https://music.megabyte.space/press/chef-lu-stew
TikTok clip: https://music.megabyte.space/clip/chef-lu-stew
Spotify:    https://open.spotify.com/track/7iXeCejHToTccIklUePuem

Sync clearance available. Faith-positive cues welcome.
— Brian (bZ)
```

The `scripts/send-curator-outreach.mjs` script bundles this as a templated Resend send for confirmed curator addresses.

<hr/>

## TikTok-ready clips

`/clip/{trackId}` renders a 1080×1920 vertical surface — cover art floating with a slow drift animation, lyric karaoke synced to the audio, BPM/key chips, brand watermark. Open on a phone, hit **Play 15s**, screen-record from Control Center → upload to TikTok/Reels/Shorts.

```
https://music.megabyte.space/clip/bootleg-from-tomorrow
https://music.megabyte.space/clip/chef-lu-stew
```

<hr/>

## AI DJ chat

`⌘K` opens the panel. Powered by Cloudflare Workers AI (Llama 3.3 70B FP8-fast for normal mode, 3.1 8B as automatic fallback on transient failures). The chat is page-aware — it knows what track is playing, what content page you're reading, your recent listens. Drag-drop any file from the page to attach context. `/shortcommands` lists every slash command.

**Examples:**
- `/track birch-swing-heaven` — open the track details widget
- `/album canopy` — load the album metadata
- `/pin <note>` — pin a fact for the chat to remember
- `/voice` — toggle voice input (Whisper STT)
- `/snippet save <name>` — save a reusable prompt fragment

<hr/>

## Adding a new release

The *Bootleg From Tomorrow* album was added in a single session using this flow:

1. Drop MP3s into `public/audio/{slug}.mp3` (kebab-case filenames)
2. Run `node scripts/fetch-suno-lyrics.mjs` to pull source lyrics from your Suno feed
3. Append track + album entries to `src/data.ts` (use any existing track block as a template)
4. Generate cover art: `node scripts/gen-covers.mjs <album-id>` (or paste your own)
5. Whisper-align: `node scripts/align-whisper-lyrics.mjs <track-slug>` — produces `public/lyrics/{slug}.json`
6. Append per-track SUNO_META entries (BPM/key/duration parsed from Suno style tags)
7. `npm run build && npx wrangler deploy`

Press kits, TikTok clips, search results, and the per-album visualizer accent **all auto-update** from the data layer.

<hr/>

## Scripts

```bash
npm run dev                                       # vite dev server
npm run build                                     # tsc -b + vite + embed bundle + prebuild
npm run test:e2e                                  # Playwright PROD smoke
npx wrangler deploy                               # ship

node scripts/fetch-suno-lyrics.mjs                # pull suno feed → data/suno-feed.json
node scripts/align-whisper-lyrics.mjs <slug>      # whisper + needleman-wunsch
node scripts/gen-og-cards.mjs                     # per-track DALL-E OG cards
node scripts/gen-tracks-manifest.mjs              # public/tracks.json (powers /press related)
node scripts/build-favicon-set.mjs                # full real-favicon-generator output
node scripts/send-curator-outreach.mjs --to=...   # Resend email to a curator
```

<hr/>

## Contributing

This is bZ's production codebase, so PRs that change branding, copy, or musical content won't land. But pull requests are welcome for:

- New visualizer modes in `src/visualizer.ts`
- New AI chat widgets in `src/ai-widgets.ts`
- New press-kit / clip layouts in `worker/index.ts`
- Tooling improvements in `scripts/`
- Accessibility / performance fixes

See [CLAUDE.md](./CLAUDE.md) for the agent-collaboration brief that powers this repo's day-to-day.

<hr/>

## License

Code released under [MIT](LICENSE).

Music + lyrics + cover art + the bZ name and likeness are **© Brian Zalewski / Megabyte Labs** and all rights reserved — fork the engine, don't fork the catalog. See [LICENSE-CONTENT.md](LICENSE-CONTENT.md) for details.

<br/>
<div align="center">
  <sub>Built by <a href="https://megabyte.space">Brian Zalewski / Megabyte Labs</a> · Newark NJ · 2026</sub>
</div>
