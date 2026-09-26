#!/usr/bin/env bash
# Launch the built app and save screenshots of its main screens, the whole
# desktop, and the app icon as macOS draws it.
#
# Usage (from the repo root, after build-dmg.sh): bash dist/mac/screenshots.sh [outDir]
set -uo pipefail

cd "$(dirname "$0")/../.."

OUT="${1:-screenshots}"
APP="$(ls -d build/*/osx64/*.app | head -1)"
EXE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
mkdir -p "$OUT"

swift dist/mac/render-icon.swift "$APP" "$OUT/icon.png" || echo "Icon render failed"

"$APP/Contents/MacOS/$EXE" --remote-debugging-port=9222 > "$OUT/app.log" 2>&1 &
PID=$!

status=0
node dist/mac/screenshots.js "$OUT" 9222 || status=1
screencapture -x "$OUT/desktop.png" || echo "Desktop capture failed"

if ! kill -0 "$PID" 2>/dev/null; then
  echo "App exited early"
  status=1
fi
kill "$PID" 2>/dev/null
sleep 2
pkill -f "$APP/Contents" 2>/dev/null
exit $status
