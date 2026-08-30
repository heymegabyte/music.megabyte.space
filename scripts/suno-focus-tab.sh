#!/usr/bin/env bash
# suno-focus-tab.sh — ensure Chrome shows the Suno Library. Focus an existing
# suno.com tab if present; otherwise OPEN a new tab at suno.com/me. Never
# navigates a non-Suno tab (leaves projectsites automation untouched). Prints URL.
set -uo pipefail
osascript <<'APPLESCRIPT'
tell application "Google Chrome"
  activate
  set foundWin to missing value
  set foundIdx to 0
  repeat with w in windows
    set i to 0
    repeat with t in tabs of w
      set i to i + 1
      if (URL of t) contains "suno.com" then
        set foundWin to w
        set foundIdx to i
      end if
    end repeat
  end repeat
  if foundWin is not missing value then
    set active tab index of foundWin to foundIdx
    set index of foundWin to 1
    set URL of active tab of foundWin to "https://suno.com/me"
  else
    if (count of windows) is 0 then
      make new window
    end if
    tell front window to make new tab with properties {URL:"https://suno.com/me"}
  end if
end tell
APPLESCRIPT
sleep 6
osascript -e 'tell application "Google Chrome" to return (URL of active tab of front window)' 2>/dev/null
