#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/jsvm.js-mode.exe}
SOURCE=${JSVM_SOURCE:-$ROOT/jsvm_self.c}
SEED=${JSVM_JS_MODE_SEED:-$ARTIFACTS/jsvm.js-mode.seed.exe}
RUN_I386=${RUN_I386:-$ROOT/scripts/run-i386.sh}

mkdir -p "$ARTIFACTS"

if [ ! -x "$SEED" ]; then
    "$ROOT/scripts/build-jsvm-awk.sh" "$SEED" >/dev/null
fi

"$RUN_I386" "$SEED" --js "$SOURCE" -- "$SOURCE" -o "$OUT"
chmod +x "$OUT"
printf '%s\n' "$OUT"
