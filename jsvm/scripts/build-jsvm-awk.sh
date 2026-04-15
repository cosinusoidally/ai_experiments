#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/jsvm.awk.exe}
SOURCE=${JSVM_SOURCE:-$ROOT/jsvm_self.c}

mkdir -p "$ARTIFACTS"
cd "$ROOT"
mawk -v SOURCE="$SOURCE" -v OUT="$OUT" \
    -f "$ROOT/scripts/jsvm-awk-runner.awk" \
    -f "$SOURCE"
chmod +x "$OUT"
printf '%s\n' "$OUT"
