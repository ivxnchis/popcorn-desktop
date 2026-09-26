#!/usr/bin/env bash
# Build a native Apple Silicon Popcorn-Time.app and package it as a .dmg.
#
# Usage (from the repo root, on an Apple Silicon Mac, after `yarn install`):
#   bash dist/mac/build-dmg.sh [nwVersion]
#
# nw-builder 3 only knows the Intel `osx64` target, so we pre-load an arm64
# NW.js into its download cache and let it build "osx64" from that. The
# result is ad-hoc signed (no Apple Developer account needed) and packed
# into build/<name>-<version>-macos-arm64.dmg.
set -euo pipefail

cd "$(dirname "$0")/../.."

NW_VERSION="${1:-$(sed -n "s/^const defaultNwVersion = '\([^']*\)'.*/\1/p" gulpfile.js)}"
ARCH=arm64
FLAVOR=sdk
APP_NAME="$(node -p "require('./package.json').name")"
NW_CACHE="cache/${NW_VERSION}-${FLAVOR}/osx64"
APP="build/${APP_NAME}/osx64/${APP_NAME}.app"

fetch() {
  curl -fL --retry 3 --retry-delay 5 -o "$2" "$1"
}

is_zip() {
  [ -s "$1" ] && [ "$(head -c 2 "$1")" = "PK" ]
}

prepare_nwjs() {
  local bin="$NW_CACHE/nwjs.app/Contents/MacOS/nwjs"
  if [ -f "$bin" ] && [ "$(lipo -archs "$bin")" = "$ARCH" ]; then
    echo "Using cached NW.js $NW_VERSION ($ARCH)"
    return
  fi
  rm -rf "$NW_CACHE"

  local tmp url="" base
  tmp="$(mktemp -d)"
  for base in https://popcorn-time.serv00.net/nw https://dl.nwjs.io; do
    echo "Trying $base/v$NW_VERSION/nwjs-$FLAVOR-v$NW_VERSION-osx-$ARCH.zip"
    if fetch "$base/v$NW_VERSION/nwjs-$FLAVOR-v$NW_VERSION-osx-$ARCH.zip" "$tmp/nwjs.zip" &&
      is_zip "$tmp/nwjs.zip"; then
      url="$base"
      break
    fi
  done
  if [ -z "$url" ]; then
    echo "No $ARCH build of NW.js $NW_VERSION found" >&2
    exit 1
  fi
  echo "Downloaded NW.js from $url"

  # ditto keeps the framework symlinks intact, which codesign needs
  ditto -x -k "$tmp/nwjs.zip" "$tmp/nwjs"
  local src
  src="$(find "$tmp/nwjs" -maxdepth 3 -type d -name nwjs.app | head -1)"
  if [ -z "$src" ]; then
    echo "nwjs.app not found in the NW.js download" >&2
    exit 1
  fi
  src="$(dirname "$src")"
  mkdir -p "$NW_CACHE"
  ditto "$src" "$NW_CACHE"

  # Stock NW.js ffmpeg has no H.264/AAC; swap in the proprietary-codec build
  local ff="https://github.com/nwjs-ffmpeg-prebuilt/nwjs-ffmpeg-prebuilt/releases/download/$NW_VERSION/$NW_VERSION-osx-$ARCH.zip"
  echo "Trying $ff"
  if fetch "$ff" "$tmp/ffmpeg.zip" && is_zip "$tmp/ffmpeg.zip"; then
    ditto -x -k "$tmp/ffmpeg.zip" "$tmp/ffmpeg"
    local lib dest
    lib="$(find "$tmp/ffmpeg" -type f -name libffmpeg.dylib | head -1)"
    if [ -z "$lib" ]; then
      echo "libffmpeg.dylib not found in the ffmpeg download" >&2
      exit 1
    fi
    while IFS= read -r dest; do
      cp "$lib" "$dest"
      echo "Replaced $dest"
    done < <(find "$NW_CACHE/nwjs.app" -type f -name libffmpeg.dylib)
  else
    echo "WARNING: no codec-enabled ffmpeg for NW.js $NW_VERSION ($ARCH); some videos may not play" >&2
  fi

  rm -rf "$tmp"
}

build_app() {
  rm -rf "build/${APP_NAME}"
  yarn gulp build --platforms=osx64 --nwVersion="$NW_VERSION"
  # the gulp task logs build errors instead of failing, so check the output
  if [ ! -d "$APP" ]; then
    echo "Build failed: $APP not found" >&2
    exit 1
  fi
}

sign_app() {
  echo "Ad-hoc signing $APP"
  xattr -cr "$APP"
  # sign every loose Mach-O first (native node modules, dylibs), then the bundle
  local f
  while IFS= read -r -d '' f; do
    if file -b "$f" | grep -q '^Mach-O'; then
      codesign --force --sign - "$f"
    fi
  done < <(find "$APP" -type f \( -perm -u+x -o -name '*.dylib' -o -name '*.node' -o -name '*.so' \) -print0)
  codesign --force --deep --sign - "$APP"
  codesign --verify --deep --verbose=2 "$APP"
}

report() {
  local exe
  exe="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"
  echo "Main executable: $(lipo -archs "$APP/Contents/MacOS/$exe")"
  echo "Native modules:"
  find "$APP/Contents/Resources/app.nw" -name '*.node' | while IFS= read -r f; do
    echo "  ${f#*app.nw/}: $(lipo -archs "$f" 2>/dev/null || echo 'not Mach-O')"
  done
}

make_dmg() {
  local version stage dmg i
  version="$(node -p "try { require('./git.json').semver } catch (e) { require('./package.json').version }")"
  dmg="build/${APP_NAME}-${version}-macos-${ARCH}.dmg"
  stage="$(mktemp -d)"
  ditto "$APP" "$stage/${APP_NAME}.app"
  ln -s /Applications "$stage/Applications"
  rm -f "$dmg"
  # hdiutil is occasionally "Resource busy" on CI runners
  for i in 1 2 3; do
    hdiutil create -volname "Popcorn Time" -srcfolder "$stage" -fs HFS+ -format UDZO -ov "$dmg" && break
    echo "hdiutil failed (attempt $i)"
    sleep 5
  done
  rm -rf "$stage"
  if [ ! -f "$dmg" ]; then
    echo "Could not create $dmg" >&2
    exit 1
  fi
  echo "Created $dmg ($(du -h "$dmg" | cut -f1))"
}

prepare_nwjs
build_app
sign_app
report
make_dmg
