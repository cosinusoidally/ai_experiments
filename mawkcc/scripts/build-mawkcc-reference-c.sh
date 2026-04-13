#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/mawkcc.reference-c.exe}
CC_BIN=$ARTIFACTS/mawkcc_orig

mkdir -p "$ARTIFACTS"
cc -ansi -m32 -g -O0 "$ROOT/mawkcc_orig.c" -o "$CC_BIN"
"$CC_BIN" -p 262144 "$ROOT/mawkcc_self.c" > "$OUT"
chmod +x "$OUT"
printf '%s\n' "$OUT"
