#!/usr/bin/env bash
# suno-loop-guard.sh — readiness check. Brian override: stop at nothing. Only SKIP
# if Chrome isn't running (the focus helper opens the Suno tab; login is checked
# after focusing, in STEP 3).
set -uo pipefail
if ! pgrep -x "Google Chrome" >/dev/null 2>&1; then echo "SKIP: Chrome not running"; exit 1; fi
echo "READY"; exit 0
