#!/usr/bin/env bash
# Build script for WPBleeder (Chrome & Firefox) on Linux / macOS
set -e

TARGET="${1:-chrome}"

if [ "$TARGET" != "chrome" ] && [ "$TARGET" != "firefox" ]; then
    echo "Usage: ./scripts/build.sh [chrome|firefox]"
    exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/src"
DIST_DIR="$ROOT_DIR/dist/$TARGET"

echo "Building WPBleeder for $TARGET..."

# 1. Clean output directory
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"

# 2. Merge manifests using Python
echo "Merging manifests..."
python3 -c "
import json, sys

with open('$SRC_DIR/manifest/manifest.common.json', 'r', encoding='utf-8') as f:
    common = json.load(f)

with open('$SRC_DIR/manifest/manifest.$TARGET.json', 'r', encoding='utf-8') as f:
    target = json.load(f)

def merge(base, overlay):
    res = dict(base)
    for k, v in overlay.items():
        if k in res and isinstance(res[k], dict) and isinstance(v, dict):
            res[k] = merge(res[k], v)
        elif k in res and isinstance(res[k], list) and isinstance(v, list):
            res[k] = list(dict.fromkeys(res[k] + v))
        else:
            res[k] = v
    return res

final_manifest = merge(common, target)
with open('$DIST_DIR/manifest.json', 'w', encoding='utf-8') as f:
    json.dump(final_manifest, f, indent=2)
"

echo "  manifest.json written"

# 3. Copy directories
echo "Copying files..."
for d in background content panel options platform lib; do
    if [ -d "$SRC_DIR/$d" ]; then
        cp -r "$SRC_DIR/$d" "$DIST_DIR/"
        echo "  $d/ ($(find "$DIST_DIR/$d" -type f | wc -l) files)"
    fi
done

if [ -d "$ROOT_DIR/data" ]; then
    cp -r "$ROOT_DIR/data" "$DIST_DIR/"
    echo "  data/ ($(find "$DIST_DIR/data" -type f | wc -l) files)"
fi

if [ -d "$ROOT_DIR/icons" ]; then
    cp -r "$ROOT_DIR/icons" "$DIST_DIR/"
    echo "  icons/ ($(find "$DIST_DIR/icons" -type f | wc -l) files)"
fi

echo ""
echo "Build complete! Load extension from:"
echo "  $DIST_DIR"
echo ""
if [ "$TARGET" = "chrome" ]; then
    echo "Chrome/Chromium: chrome://extensions -> Developer mode -> Load unpacked -> select dist/chrome"
else
    echo "Firefox: about:debugging -> This Firefox -> Load Temporary Add-on -> select dist/firefox/manifest.json"
fi
