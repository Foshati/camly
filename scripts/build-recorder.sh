#!/usr/bin/env bash
# Builds the native ScreenCaptureKit helper as a Tauri sidecar
# (src-tauri/binaries/camly-capture-<target-triple>).
set -euo pipefail
cd "$(dirname "$0")/.."

# CI can cross-build Intel/Apple Silicon by setting TARGET_TRIPLE (matches `tauri build --target`).
TRIPLE="${TARGET_TRIPLE:-$(rustc -vV | sed -n 's/^host: //p')}"
case "$TRIPLE" in
  aarch64-apple-darwin) ARCH=arm64 ;;
  x86_64-apple-darwin) ARCH=x86_64 ;;
  *) echo "Camly only builds on macOS (got $TRIPLE)" >&2; exit 1 ;;
esac

OUT="src-tauri/binaries/camly-capture-${TRIPLE}"
mkdir -p src-tauri/binaries

CACHE="${TMPDIR:-/tmp}/camly-swift-cache"
mkdir -p "$CACHE"
CLANG_MODULE_CACHE_PATH="$CACHE" "$(xcrun -f swiftc)" -O -swift-version 5 \
  -sdk "$(xcrun --show-sdk-path)" -module-cache-path "$CACHE" \
  -target "${ARCH}-apple-macos15.0" \
  -framework ScreenCaptureKit -framework AVFoundation -framework CoreMedia \
  -framework VideoToolbox -framework AppKit \
  recorder/*.swift -o "$OUT"

echo "✓ recorder built → $OUT"
