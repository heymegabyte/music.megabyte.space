#!/usr/bin/env bash
# suno-loop-guard.sh — decide whether it's safe for the Suno download loop to take
# over the desktop THIS cycle. Exit 0 = READY (drive Computer Use); exit 1 = SKIP
# (do nothing, pick it up next loop). Prevents fighting the user or another agent.
#   SKIP when: the Emdash coding window is frontmost (user is working), OR
#              Chrome's active tab is a projectsites.dev / localhost automation.
set -uo pipefail

front="$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null || echo unknown)"
case "$front" in
  Emdash|emdash|Electron)
    echo "SKIP: '$front' is frontmost (user working) — retry next loop"; exit 1;;
esac

tab="$(osascript -e 'tell application "Google Chrome" to get URL of active tab of front window' 2>/dev/null || echo none)"
case "$tab" in
  *projectsites.dev*|*localhost:*|*127.0.0.1:*)
    echo "SKIP: Chrome mid projectsites automation ($tab) — retry next loop"; exit 1;;
esac

# Confirm a Suno session is reachable (any Chrome tab on suno.com). Not fatal if
# absent — the loop will navigate — but we require Chrome to be running.
if ! pgrep -x "Google Chrome" >/dev/null 2>&1; then
  echo "SKIP: Chrome not running — retry next loop"; exit 1
fi
echo "READY (front=$front, chromeTab=$tab)"; exit 0
