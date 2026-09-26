#!/usr/bin/env bash
# Launch the built app and save screenshots of its main screens, the whole
# desktop, and the app icon as macOS draws it.
#
# Usage (from the repo root, after build-dmg.sh): bash dist/mac/screenshots.sh [outDir]
set -uo pipefail

cd "$(dirname "$0")/../.."

OUT="${1:-screenshots}"
APP="$(cd "$(dirname "$(ls -d build/*/osx64/*.app | head -1)")" && pwd)/$(basename "$(ls -d build/*/osx64/*.app | head -1)")"
EXE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
mkdir -p "$OUT"

swift dist/mac/render-icon.swift "$APP" "$OUT/icon.png" || echo "Icon render failed"

launch() {
  "$APP/Contents/MacOS/$EXE" --remote-debugging-port=9222 >> "$OUT/app.log" 2>&1 &
  PID=$!
}

stop() {
  kill "$PID" 2>/dev/null
  sleep 2
  pkill -f "$APP/Contents" 2>/dev/null
  sleep 1
}

node dist/mac/sample-api.js 8099 > "$OUT/sample-api.log" 2>&1 &
API_PID=$!

# prefer the real API servers; use the local sample data if none of them answer
REAL_API="${SCREENSHOT_API:-https://fusme.link/,https://jfper.link/,https://uxert.link/,https://yrkde.link/}"
export API_URLS="http://127.0.0.1:8099/"
for url in ${REAL_API//,/ }; do
  body="$(curl -sf -m 15 "${url}movies/1?sort=trending&limit=50&showAll=1" 2>/dev/null)"
  if [ "${body:0:1}" = "[" ]; then
    API_URLS="$REAL_API"
    break
  fi
done
echo "Screenshots use API servers: $API_URLS"

status=0

# first launch: accept the terms and set the API servers, then quit
launch
node dist/mac/screenshots.js "$OUT" 9222 prepare || status=1
for _ in $(seq 1 15); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 1
done
stop

# second launch: the app is set up, take the screenshots
launch
node dist/mac/screenshots.js "$OUT" 9222 capture || status=1
screencapture -x "$OUT/desktop.png" || echo "Desktop capture failed"

if ! kill -0 "$PID" 2>/dev/null; then
  echo "App exited early"
  status=1
fi
stop
kill "$API_PID" 2>/dev/null
exit $status
