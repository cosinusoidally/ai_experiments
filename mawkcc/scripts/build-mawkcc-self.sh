#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/mawkcc.self.exe}
SEED=$ARTIFACTS/mawkcc.self.seed.exe

mkdir -p "$ARTIFACTS"
mawk -v code_page=262144 -f "$ROOT/cc.awk" "$ROOT/mawkcc_self.c" > "$SEED"
chmod +x "$SEED"
"$SEED" -p 262144 "$ROOT/mawkcc_self.c" > "$OUT"
chmod +x "$OUT"
printf '%s\n' "$OUT"
