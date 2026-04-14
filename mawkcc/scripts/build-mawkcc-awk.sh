#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/mawkcc.awk.exe}

mkdir -p "$ARTIFACTS"
cd "$ROOT"
mawk -v SOURCE="$ROOT/mawkcc_self.c" -v OUT="$OUT" \
    -f "$ROOT/scripts/mawkcc-awk-runner.awk" \
    -f "$ROOT/mawkcc_self.c"
chmod +x "$OUT"
printf '%s\n' "$OUT"
