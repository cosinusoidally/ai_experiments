#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/jsvm.self.exe}
SOURCE=${JSVM_SOURCE:-$ROOT/jsvm_self.c}
SEED=$ARTIFACTS/jsvm.self.seed.exe
RUN_I386=${RUN_I386:-$ROOT/scripts/run-i386.sh}

mkdir -p "$ARTIFACTS"
"$ROOT/scripts/build-jsvm-awk.sh" "$SEED" >/dev/null
"$RUN_I386" "$SEED" "$SOURCE" > "$OUT"
chmod +x "$OUT"
printf '%s\n' "$OUT"
