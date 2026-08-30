#!/usr/bin/env bash
# suno-loop-guard.sh — readiness check for the Suno download loop.
# Brian override (2026-08-30): do NOT defer for Emdash-frontmost or projectsites
# automation — just switch to the Suno tab and work ("stop at nothing"). Only SKIP
# when the environment genuinely can't run: Chrome not running, or no Suno session.
set -uo pipefail
if ! pgrep -x "Google Chrome" >/dev/null 2>&1; then echo "SKIP: Chrome not running"; exit 1; fi
if ! osascript -e 'tell application "Google Chrome" to get URL of every tab of every window' 2>/dev/null | grep -q "suno.com"; then
  echo "SKIP: no suno.com tab open — open Suno + sign in"; exit 1
fi
echo "READY (Chrome up, Suno tab present)"; exit 0
