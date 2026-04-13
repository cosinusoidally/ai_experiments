#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/mawkcc.awk.exe}

mkdir -p "$ARTIFACTS"
mawk -v code_page=262144 -f "$ROOT/cc.awk" "$ROOT/mawkcc_self.c" > "$OUT"
chmod +x "$OUT"
printf '%s\n' "$OUT"
