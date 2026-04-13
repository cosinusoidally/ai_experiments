#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/mawkcc.js.exe}

mkdir -p "$ARTIFACTS"
cd "$ROOT"
js "$ROOT/scripts/mawkcc-js-runner.js" "$ROOT/mawkcc_self.c" "$OUT"
chmod +x "$OUT"
printf '%s\n' "$OUT"
