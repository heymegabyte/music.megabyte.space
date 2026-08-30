# Suno media download loop — runbook

Extract **WAV + MIDI + VIDEO** for every music.megabyte.space song from Suno, one song
per loop iteration. Derived from the walkthrough video `~/Desktop/suno-suno-suno.mov`
(2026-08-30). Driven by **Computer Use** on the user's Suno-logged-in Chrome.

## Preconditions (the loop CANNOT run without these)

- Google Chrome **logged into Suno** (account `brian404`, Pro plan) at `suno.com/me`, window focused.
  Verify: `osascript -e 'tell application "Google Chrome" to return URL of active tab of front window'`
  must resolve to `suno.com/me` showing the Library (NOT redirect to `suno.com/` = logged out).
- Suno session is a **login only the user can provide** — do not attempt to authenticate.

## State

- **Worklist:** `data/suno-download-queue.json` — 109 songs in site order (`npm run suno:queue` rebuilds, preserves status).
  Each entry: `{order, trackId, title, album, siteSec, siteMMSS, sunoId, sunoSec, durMatch, status}`.
- **status:** `pending → done` (or `partial:wav+stems` / `blocked`). `done` = WAV + stems/MIDI + video all present.
- End songs (per narration): #47 **Only Human** (`st-johns-halo`), #48 **Come Through** (`soup-kitchen-windows`).

## Per-song procedure (one loop iteration)

1. Pick the first `status:"pending"` song from the queue. Note its `title` + `siteMMSS`.
2. In Suno Library (`suno.com/me`, Songs tab), type the `title` into the search box.
3. **Match by duration:** among results, pick the clip whose length ≈ `siteMMSS` (±~2s). Site 2:14 → Suno 2:15 in the demo.
   If two results share that duration, load each (click ▶) and listen — pick the one that sounds identical to the site track.
4. Open the row's **`⋯`** (more) menu → **Download** ▸ submenu:
   - **WAV Audio** (Pro) → confirms a "Download WAV Audio" modal → download → `~/Downloads/<Title>.wav`.
   - **Get Stems / MIDI** (Pro) → "Extract Stems and MIDI" modal → **Auto split** (default) → **Extract** (red) →
     WAIT for extraction (minutes; 12 instruments) → **Download ▾** (bottom-right) → downloads `~/Downloads/<Title> Stems.zip`
     (7 stems × {mp3, wav, **.mid**} — the MIDI source).
   - **Video** (Pro) → generates a lyric video → WAIT for it to finish → download → `~/Downloads/<Title>.mp4`.
5. `node scripts/ingest-suno-downloads.mjs` — moves the 3 files into `public/media/<id>.{wav,mp4}` +
   `public/media/stems/<id>.zip`, matches by normalized title, flips the queue entry to `done`.
6. Loop: next `pending` song. **Self-cancel** when 0 pending remain.

## Verified output shape (demo: Soupe Saint-Jean, `soupe-saint-jean`, 2026-08-30)

- `<Title>.wav` — full-song WAV, matches site duration (134.5s). → `public/media/<id>.wav`
- `<Title>.mp4` — lyric video, matches duration (134.4s). → `public/media/<id>.mp4`
- `<Title> Stems.zip` — 7 stems (Bass/Backing Vocals/Vocals/Synth/Drums/FX/Percussion) × {mp3, wav, mid}. → `public/media/stems/<id>.zip`

`public/media/*.{wav,mp4,mid}` + `public/media/stems/` are gitignored (large — host separately, e.g. R2).

## Loop resilience guard (MUST run first each cycle)

`bash scripts/suno-loop-guard.sh` — exit 0 = READY, exit 1 = SKIP (do nothing, retry next loop).
SKIPs when: the **Emdash** window is frontmost (user working) OR Chrome's active tab is a
**projectsites.dev / localhost** automation (another agent driving Chrome) OR Chrome isn't running.
This lets the loop share the desktop — it only takes the foreground when it's free for Suno.

## Loop cron (one song per fire, self-cancelling)

Each fire: run the guard → if SKIP, stop + retry next fire → if READY, activate Chrome's Suno tab
(`osascript` → `suno.com/me`), download the next `pending` song per the procedure above via Computer
Use, then `npm run suno:ingest` (moves to `public/media` + uploads to R2 + marks the song `done`).
When 0 `pending` remain, `CronDelete` self. Cadence ~30m (one song ≈ 10-15 min + buffer).

## R2 serving

`public/media/*` served from R2 bucket `music-megabyte-space-media` via the worker `/media/*` route
(Range-aware). Ingest uploads each file (`<id>.wav`, `<id>.mp4`, `stems/<id>.zip`). NOTE (2026-08-30):
R2 storage confirmed (objects persist + retrieve via CLI) but the Workers binding view lagged on the
brand-new bucket (`/media/*` 404 while `object_count` read 0 — stale stats, not jurisdiction). Re-verify
`curl https://music.megabyte.space/media/chef-lu-stew.mp4` after propagation; if still 404, redeploy the worker.

## Status (2026-08-30)

- **Full download flow PROVEN via Computer Use** — `chef-lu-stew` (3:00 match) downloaded WAV (33MB) +
  Stems/MIDI zip (122MB, MP3+WAV+MIDI) + lyric video (6.6MB), all → `public/media` + R2. 2/109 done
  (`soupe-saint-jean` + `chef-lu-stew`).
- Guard TESTED (correctly SKIPs when Emdash frontmost).
- Loop armed as a recurring cron (guard-gated, one song/fire, self-cancels at 0 pending).
