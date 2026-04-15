#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/jsvm.js.exe}
SOURCE=${JSVM_SOURCE:-$ROOT/jsvm_self.c}

mkdir -p "$ARTIFACTS"
cd "$ROOT"
js "$ROOT/scripts/jsvm-js-runner.js" "$SOURCE" "$OUT"
chmod +x "$OUT"
printf '%s\n' "$OUT"
