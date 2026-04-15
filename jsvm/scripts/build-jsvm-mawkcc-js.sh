#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
REPO=$(CDPATH= cd -- "$ROOT/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/jsvm.mawkcc-js.exe}
SOURCE=${JSVM_SOURCE:-$ROOT/jsvm_self.c}
MAWKCC_JS=${MAWKCC_JS:-$REPO/mawkcc/artifacts/mawkcc.js.exe}
RUN_I386=${RUN_I386:-$ROOT/scripts/run-i386.sh}

mkdir -p "$ARTIFACTS"

if [ ! -x "$MAWKCC_JS" ]; then
    "$REPO/mawkcc/scripts/build-mawkcc-js.sh" "$MAWKCC_JS" >/dev/null
fi

"$RUN_I386" "$MAWKCC_JS" "$SOURCE" > "$OUT"
chmod +x "$OUT"
printf '%s\n' "$OUT"
