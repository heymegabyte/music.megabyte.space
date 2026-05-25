#!/usr/bin/env python3
"""Per-track audio analysis: BPM (via aubio) + musical key (Krumhansl–
Schmuckler over a chromagram). Output: data/audio-analysis.json keyed by
track id.

Pipeline:
  1. ffmpeg → decode mp3 → mono 22050 Hz 16-bit PCM (in-memory bytes)
  2. aubio.tempo() walks the signal for tempo estimation; median of all
     detected beat intervals = aggregate BPM (more stable than the last
     instantaneous reading the aubio CLI prints).
  3. Chromagram: STFT (4096-sample windows, 2048 hop, Hann window) →
     magnitude spectrum → fold each bin to its nearest pitch class (0-11
     = C, C#, …, B) → sum across all frames → normalize.
  4. KS correlation: rotate the 12-element chroma by each of the 12 tonic
     candidates, dot-product against the Temperley-revised Krumhansl-
     Schmuckler major + minor profiles, pick the highest-correlation
     (tonic, mode) pair.

Usage:
  python3 scripts/analyze-audio.py                 # analyze all tracks in src/data.ts
  python3 scripts/analyze-audio.py track-id …      # analyze specific tracks
  python3 scripts/analyze-audio.py --force         # ignore cache, re-analyze all
"""

import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import aubio

ROOT = Path(__file__).resolve().parent.parent
DATA_TS = ROOT / "src" / "data.ts"
AUDIO_DIR = ROOT / "public" / "audio"
OUT_PATH = ROOT / "data" / "audio-analysis.json"
SAMPLE_RATE = 22050  # downsample target — plenty for BPM + chromagram
HOP = 512
WIN = 1024  # aubio tempo expects window=hop*2 typically

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl–Schmuckler key profiles (Temperley 1999 revision — better
# correlation with Western tonal music than original 1990 weights).
KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def parse_tracks() -> list[tuple[str, str]]:
    """Return list of (track_id, audio_filename) pairs from src/data.ts."""
    src = DATA_TS.read_text(encoding="utf-8")
    start = src.find("export const TRACKS")
    region = src[start:]
    # Match track blocks (file: '/audio/...' required to exclude albums).
    block_re = re.compile(
        r"\{\s*id:\s*'([^']+)'[\s\S]*?file:\s*'/audio/([^']+)'", re.MULTILINE
    )
    out = []
    seen = set()
    for m in block_re.finditer(region):
        tid, fname = m.group(1), m.group(2)
        if tid in seen:
            continue
        seen.add(tid)
        out.append((tid, fname))
    return out


def decode_mp3(path: Path) -> np.ndarray:
    """Decode mp3 → mono float32 array @ SAMPLE_RATE Hz via ffmpeg.

    Pipes raw PCM to stdout so we never write a temp wav file. -y to
    overwrite (no-op for stdout). -loglevel error to suppress banners.
    """
    cmd = [
        "ffmpeg",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-ac",
        "1",
        "-ar",
        str(SAMPLE_RATE),
        "-f",
        "s16le",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True, check=True)
    pcm = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    return pcm


def detect_bpm(audio: np.ndarray) -> float | None:
    """Median-of-intervals tempo estimation via aubio's `tempo` aubio object."""
    if len(audio) < SAMPLE_RATE * 4:  # need at least 4s
        return None
    tempo = aubio.tempo("default", WIN, HOP, SAMPLE_RATE)
    beats = []
    for i in range(0, len(audio) - HOP, HOP):
        frame = audio[i : i + HOP]
        if len(frame) < HOP:
            break
        if tempo(frame):
            beats.append(tempo.get_last_s())
    if len(beats) < 4:
        return None
    intervals = np.diff(beats)
    # Trim outliers (1.5×IQR) so a missed beat doesn't pull the median.
    q1, q3 = np.percentile(intervals, [25, 75])
    iqr = q3 - q1
    keep = intervals[(intervals >= q1 - 1.5 * iqr) & (intervals <= q3 + 1.5 * iqr)]
    if not len(keep):
        return None
    median_interval = float(np.median(keep))
    if median_interval <= 0:
        return None
    bpm = 60.0 / median_interval
    # Octave-fold: aubio often reports half-time (e.g. 80 instead of 160)
    # or double-time. Pull into the canonical 70-180 BPM window.
    while bpm < 70:
        bpm *= 2
    while bpm > 180:
        bpm /= 2
    return round(bpm, 1)


def chromagram(audio: np.ndarray, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Compute 12-element chroma (pitch-class energy) summed over the track.

    Strategy: STFT with 4096-sample Hann windows + 2048 hop. For each FFT
    bin convert to MIDI note (12*log2(f/440) + 69) → pitch class (mod 12).
    Sum magnitudes per pitch class across all frames.
    """
    n_fft = 4096
    hop = 2048
    window = np.hanning(n_fft).astype(np.float32)
    # Precompute pitch-class for each FFT bin (bins 1..n_fft/2)
    freqs = np.linspace(0, sr / 2, n_fft // 2 + 1)
    # Avoid log(0): clip bin 0 + ignore <50 Hz (subsonic) + >5000 Hz (where
    # pitch perception breaks down for tonal-key analysis).
    midi = np.zeros_like(freqs)
    valid = (freqs >= 50) & (freqs <= 5000)
    midi[valid] = 12 * np.log2(freqs[valid] / 440.0) + 69
    pitch_class = np.where(valid, np.round(midi).astype(int) % 12, -1)

    chroma = np.zeros(12, dtype=np.float64)
    for i in range(0, len(audio) - n_fft, hop):
        frame = audio[i : i + n_fft] * window
        mag = np.abs(np.fft.rfft(frame))
        # A-weighting-lite: emphasize mid bins, deemphasize sub-bass + extreme highs
        for bin_idx, pc in enumerate(pitch_class):
            if pc < 0:
                continue
            chroma[pc] += mag[bin_idx]
    # Normalize so the largest pitch class = 1
    if chroma.max() > 0:
        chroma /= chroma.max()
    return chroma


def detect_key(chroma: np.ndarray) -> tuple[str, str, float]:
    """Krumhansl-Schmuckler: rotate chroma against the 12 tonic candidates,
    correlate with major + minor profiles. Return (tonic, mode, confidence)."""
    best = (0, "major", -2.0)
    for tonic in range(12):
        rotated = np.roll(chroma, -tonic)
        for mode_name, profile in (("major", KS_MAJOR), ("minor", KS_MINOR)):
            # Pearson correlation
            c = float(np.corrcoef(rotated, profile)[0, 1])
            if c > best[2]:
                best = (tonic, mode_name, c)
    return NOTE_NAMES[best[0]], best[1], round(best[2], 3)


def load_cache() -> dict:
    if OUT_PATH.exists():
        try:
            return json.loads(OUT_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {"generated_at": None, "tracks": {}}


def main():
    args = sys.argv[1:]
    force = "--force" in args
    targets = [a for a in args if a != "--force"]

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    cache = load_cache()

    all_tracks = parse_tracks()
    if targets:
        all_tracks = [t for t in all_tracks if t[0] in targets]

    print(f"Analyzing {len(all_tracks)} track(s)…", file=sys.stderr)
    ok = skip = fail = 0
    started = time.time()

    for idx, (tid, fname) in enumerate(all_tracks, 1):
        path = AUDIO_DIR / fname
        prefix = f"[{idx:>2}/{len(all_tracks)}] {tid:<32}"
        if not path.exists():
            print(f"{prefix} ✗ audio missing: {fname}", file=sys.stderr)
            fail += 1
            continue
        if not force and tid in cache["tracks"]:
            cached = cache["tracks"][tid]
            if "bpm" in cached and "key" in cached:
                print(f"{prefix} — cached", file=sys.stderr)
                skip += 1
                continue
        try:
            audio = decode_mp3(path)
            bpm = detect_bpm(audio)
            chroma = chromagram(audio)
            tonic, mode, conf = detect_key(chroma)
            cache["tracks"][tid] = {
                "bpm": bpm,
                "key": f"{tonic} {mode}",
                "keyConfidence": conf,
                "duration": round(len(audio) / SAMPLE_RATE, 2),
            }
            print(
                f"{prefix} ✓ bpm={bpm}  key={tonic} {mode} (conf {conf:.2f})",
                file=sys.stderr,
            )
            ok += 1
        except subprocess.CalledProcessError as e:
            print(f"{prefix} ✗ ffmpeg failed: {e.stderr.decode()[:100]}", file=sys.stderr)
            fail += 1
        except Exception as e:
            print(f"{prefix} ✗ {type(e).__name__}: {e}", file=sys.stderr)
            fail += 1

    cache["generated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    OUT_PATH.write_text(json.dumps(cache, indent=2), encoding="utf-8")

    elapsed = time.time() - started
    print(
        f"\n{ok} analyzed · {skip} cached · {fail} failed · {elapsed:.1f}s total",
        file=sys.stderr,
    )
    print(f"Wrote {OUT_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
