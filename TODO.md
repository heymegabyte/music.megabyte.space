# TODO — music.megabyte.space

Lightweight roadmap. The autonomous loop has driven the site to a complete,
healthy state across SEO/structured-data, images, security headers, the RSS feed,
oEmbed, and player polish. What remains needs a decision or an external unblock.

## 🔴 Blocked on Brian (these unblock the next high-value batch)

- **Clear the stuck homepage edge cache.** `music.megabyte.space/` serves a stale
  HTML shell from a CF cache entry that survives every API purge (`purge_everything`
  + `files` + `hosts` all return success but don't clear it; `bzmusic.win` — same
  worker/assets, different zone — serves fresh, proving origin is fine). Worker now
  sends `no-store` on `/` but the stuck entry persists.
  → **Action:** CF dashboard → `megabyte.space` → Caching → **Purge Everything**
  (dashboard purge sometimes works where the API is shadowed). If it persists,
  check Smart Tiered Cache topology / open a CF support ticket.
  → **Impact while stuck:** no homepage `<head>`/SEO/JSON-LD edit reaches `music`
  users (app JS is hash-busted and serves fresh, so features work). Full diagnosis
  in `~/.claude/.../memory/project_homepage_cache_stuck.md`.

- **Homepage `<title>` / `og:type` framing.** Currently brands a single album
  ("Panda Desiiignare… cyan flag album", `og:type: music.album`) rather than the
  artist. Artist-led is better for "bZ" brand-search SEO, but changes how the root
  presents on social shares. → **Decide:** artist-led vs album-led, and it ships.
  (Also gated by the cache above.)

- **Zone-level HSTS.** Currently off; HSTS only rides Worker-routed responses
  (assets get it via `public/_headers`). Enabling zone-wide would unify it but
  `includeSubDomains; preload` on the shared `megabyte.space` zone could force HTTPS
  on a sibling subdomain. → **Confirm** no HTTP-only siblings, then enable.

## 🟡 External blockers

- **Smart-link deep-links** — the multi-platform tiles wait on DistroKid
  distribution completing (Spotify/Apple/YouTube/Tidal URLs).
- **Suno song generation** — blocked on the `__client` auth cookie (anti-bot);
  pipeline + creative work are ready (`~/.agentskills/rules/suno-song-generation.md`).

## 🟢 Next-up autonomous ideas (when a fire has headroom)

- Feed `enclosure length` is exact now; consider a podcast-directory submission
  flow (Apple Podcasts rejects music feeds — target generic RSS readers only).
- Loop cadence: `85ba5daf` runs every 10 min. The autonomous surface is largely
  mined — consider hourly until the blockers above clear, to cut churn.
