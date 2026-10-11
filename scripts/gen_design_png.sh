#!/usr/bin/env bash
# Render assets/design.svg and assets/integration.svg to 3x PNGs with
# Microsoft Edge headless (no librsvg needed). Run from Git Bash on Windows.
#   bash scripts/gen_design_png.sh                # both
#   bash scripts/gen_design_png.sh design         # one
# The README embeds PNGs because GitHub sanitizes some SVG features.
# Adapted from agy-staff / agy-crew (MIT, keli-wen).
set -euo pipefail
cd "$(dirname "$0")/.."
EDGE="${EDGE:-/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe}"
INTEGRATION_H="${INTEGRATION_H:-632}"

render() { # name width height
  local svg out prof
  svg="$(cygpath -m "$PWD/assets/$1.svg")"
  out="$(cygpath -w "$PWD/assets/$1.png")"
  prof="$(cygpath -w "${TMPDIR:-/tmp}")\\edge-$1-$$"
  rm -f "assets/$1.png"
  for _ in 1 2 3 4; do
    timeout 40 "$EDGE" --headless=new --disable-gpu --hide-scrollbars \
      --user-data-dir="$prof" --force-device-scale-factor=3 \
      --window-size="$2,$3" --default-background-color=FFFFFFFF \
      --screenshot="$out" "file:///$svg" </dev/null >/dev/null 2>&1 || true
    [ -s "assets/$1.png" ] && break
  done
  echo "wrote assets/$1.png"
}

case "${1:-all}" in
  design) render design 920 448 ;;
  integration) render integration 920 "$INTEGRATION_H" ;;
  *) render design 920 448; render integration 920 "$INTEGRATION_H" ;;
esac
