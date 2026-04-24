#!/bin/bash
# Generates icon.png / icon.icns / icon.ico from the best available source:
#   1. build/icon-source.png  (high-res PNG, takes priority)
#   2. build/icon.svg         (vector fallback, requires rsvg-convert)
set -e

ICONSET="build/icon.iconset"
ICNS="build/icon.icns"
ICO="build/icon.ico"
PNG="build/icon.png"
TMP_ICO="build/.ico_tmp"

# Verify common dependencies
for cmd in iconutil sips; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Error: $cmd not found (macOS required)"; exit 1; }
done
command -v magick >/dev/null 2>&1 || command -v convert >/dev/null 2>&1 || {
  echo "Error: imagemagick not found. Install via: brew install imagemagick"; exit 1;
}
MAGICK=$(command -v magick 2>/dev/null || echo "convert")

# Pick source
if [ -f "build/icon-source.png" ]; then
  echo "→ Source: build/icon-source.png (PNG)"
  sips -z 1024 1024 "build/icon-source.png" --out "$PNG" --setProperty format png >/dev/null
  RESIZE_CMD="sips -z SIZE SIZE $PNG --out TARGET >/dev/null"
  do_resize() { sips -z $1 $1 "$PNG" --out "$2" >/dev/null; }
elif [ -f "build/icon.svg" ]; then
  command -v rsvg-convert >/dev/null 2>&1 || { echo "Error: rsvg-convert not found. Install via: brew install librsvg"; exit 1; }
  echo "→ Source: build/icon.svg (SVG)"
  rsvg-convert -w 1024 -h 1024 "build/icon.svg" > "$PNG"
  do_resize() { rsvg-convert -w $1 -h $1 "build/icon.svg" > "$2"; }
else
  echo "Error: no source found. Add build/icon-source.png or build/icon.svg"; exit 1
fi

echo "  ✓ icon.png (1024×1024)"

# macOS .icns
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  do_resize $size        "$ICONSET/icon_${size}x${size}.png"
  do_resize $((size*2)) "$ICONSET/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$ICONSET"
rm -rf "$ICONSET"
echo "  ✓ icon.icns"

# Windows .ico (multi-size)
mkdir -p "$TMP_ICO"
for size in 16 24 32 48 64 128 256; do
  do_resize $size "$TMP_ICO/${size}.png"
done
$MAGICK "$TMP_ICO/16.png" "$TMP_ICO/24.png" "$TMP_ICO/32.png" "$TMP_ICO/48.png" \
        "$TMP_ICO/64.png" "$TMP_ICO/128.png" "$TMP_ICO/256.png" "$ICO"
rm -rf "$TMP_ICO"
echo "  ✓ icon.ico"

echo ""
echo "Done! Icons in build/"
echo "  build/icon.png   → source + Linux"
echo "  build/icon.icns  → macOS"
echo "  build/icon.ico   → Windows"
