# Reckless Grace — album build progress

New album (slug `reckless-grace`), title chosen by Brian 2026-09-06.
Source = Suno playlist "Woooo" (`suno.com/playlist/a49fbcf8-6b7d-4b12-833f-0e17d321e962`) + the stem ZIPs in `~/Downloads`.
Artist: bZ / brian404. Vibe: grace / recovery / dignity / wise-mind / stay-alive, hard-but-holy gospel-trap.

## Hard-won facts
- Stem ZIPs contain **separated stems only** (per-instrument MP3+WAV+MIDI) — **no master mix**. So the full song MP3+WAV are downloaded from Suno via Computer Use (Brian's instruction).
- Each title has **multiple Suno takes** (4–7). The **album take == the stem-ZIP take** (validated: all 9 first downloads matched their stem ZIP duration exactly). So pick the Library take whose duration matches the stem-ZIP duration (±2s).
- Download flow: Library (`suno.com/me`) → search title → row ⋯ → **Download** → modal: uncheck **M4A**, check **MP3** + **WAV** → Download. (Modal centered: M4A 766,383 / MP3 766,424 / WAV 766,465 / Download 766,611.) Newly-unlocked takes show "Unlock & Download" (uses plan's included download allowance, not a purchase).
- Suno Library/playlist scroll is **sluggishly virtualized** via Computer Use wheel — reaching a buried take is slow. Search narrows results; the target take may still be past several others.
- Files land as `<Title>.mp3` / `<Title>.wav` in `~/Downloads`.

## Track target durations (from stem ZIPs = album takes)
| Title | target | downloaded? |
|---|---|---|
| Reckless Grace | 4:53 (292.7s) | ✓ |
| Count What I Got | 5:27 (327.4s) | ✓ |
| Nobody Beneath Us | 5:04 (304.4s) | ✓ |
| Luminous Love | 4:30 (269.7s) | ✓ |
| Peace After Song | 5:04 (304.0s) | ✓ |
| 589% | 4:54 (294.2s) | ✓ |
| Upgrade the Game | 3:23 (202.9s) | ✓ |
| Same Moon, Different City | 4:24 (263.8s) | ✓ |
| Bassline Benediction | 4:08 (248.0s) | ✓ |
| Love Louder | **5:19–5:20 (319.6s)** | ✗ (take identified, buried in search) |
| Wise Mind Wins | 4:10 (249.7s) | ✗ |
| No Chicharrón | 3:30 (210.0s) | ✗ |
| Let the Spark Find You | 4:48 (287.7s) | ✗ |
| We Don't Need Another Martyr | 5:14 (313.9s) | ✗ |
| Building a Life Worth Staying | 4:27 (266.8s) | ✗ |
| Power Wash the Capitol | 4:33 (273.4s) | ✗ |

## Wake Up For You — 4 star mixes (placed LAST in the album), by duration
- Betelgeuse Mix — 281.6s (4:41)  ✓ downloaded + renamed
- Algenib Mix — 299.8s (4:59)  ✓
- Polaris Mix — 291.2s (4:51)  ✓
- Deneb Mix — 301.3s (5:01)  ✓  (Brian wrote "Denab"; corrected to real star "Deneb")
(5 Wake Up stem ZIPs; base == "(1)" duration, so 4 distinct versions. Match each mix's stems by duration at ingest.)

## Downloads — COMPLETE (2026-09-06)
All 20 tracks have **MP3 + WAV + MP4 + Stems** staged in `~/Downloads`, every trio duration-consistent (20/20, 0 problems):

1. ✓ **20/20 audio pairs** (MP3 + WAV) — pulled via the playlist search box (filters "Woowoo" to the single album take; no scroll-hunting). All match stem-ZIP durations (Δ≤0.2s).
2. ✓ **20/20 MP4 videos** — pulled via the playlist search box → row ⋯ → Download → modal (uncheck M4A `766,383`, check MP4 `766,507`, Download `766,611`). Each MP4 needs a ~90–150 s server-side render; wait then verify on disk. Durations match mp3/wav for all 20.
3. ✓ **Wake Up ×4 collide-rename** — the 4 "Wake Up For You" takes download with identical names → renamed by duration to star mixes: 281.6→**Betelgeuse**, 290.8→**Polaris**, 299.6→**Algenib**, 301.2→**Deneb** (mp3/wav/mp4 all consistent per mix). Note: 5 "Wake Up For You Stems*.zip" but only 4 distinct takes (one stem zip is a dup of the base).

## Remaining — PUBLISH + DEPLOY (next)
- Place: mp3→`public/audio/<id>.mp3`, wav→`public/media/<id>.wav`, mp4→`public/media/<id>.mp4`, stems→`public/media/stems/<id>.zip`; ingest WAV+stems+mp4 to R2.
- Add album `reckless-grace` + 20 track entries to `src/data.ts` (Wake Up star mixes LAST).
- Cover art (NOT in ZIPs) — generate/assign.
- Lyrics — via `npm run lyrics:rebuild` per track (or defer; karaoke off until done).
- Build → `wrangler deploy` → purge zone → prod-verify.
