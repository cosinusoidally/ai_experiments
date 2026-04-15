#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
REPO=$(CDPATH= cd -- "$ROOT/.." && pwd)
ARTIFACTS=$ROOT/artifacts
JSVM_BIN=${JSVM_BIN:-$ARTIFACTS/jsvm.exe}
REFERENCE=${REFERENCE:-$ARTIFACTS/mawkcc.reference.exe}
OUTPUT=${OUTPUT:-$ARTIFACTS/mawkcc.jsvm.exe}
REBUILT=${REBUILT:-$ARTIFACTS/mawkcc.jsvm.rebuilt.exe}
MAWKCC_AWK=${MAWKCC_AWK:-$REPO/mawkcc/cc.awk}
MAWKCC_SOURCE=${MAWKCC_SOURCE:-$REPO/mawkcc/mawkcc_self.c}
RUN_I386=${RUN_I386:-$ROOT/scripts/run-i386.sh}

mkdir -p "$ARTIFACTS"

"$ROOT/scripts/build-jsvm.sh" "$JSVM_BIN" >/dev/null

mawk -f "$MAWKCC_AWK" "$MAWKCC_SOURCE" > "$REFERENCE"
chmod +x "$REFERENCE"

"$RUN_I386" "$JSVM_BIN" "$MAWKCC_SOURCE" > "$OUTPUT"
chmod +x "$OUTPUT"

if ! cmp -s "$REFERENCE" "$OUTPUT"; then
    echo "jsvm-built mawkcc differs from reference mawkcc" >&2
    cmp -l "$REFERENCE" "$OUTPUT" | sed -n '1,20p' >&2
    exit 1
fi

"$RUN_I386" "$OUTPUT" "$MAWKCC_SOURCE" > "$REBUILT"
chmod +x "$REBUILT"

if ! cmp -s "$OUTPUT" "$REBUILT"; then
    echo "jsvm-built mawkcc failed to rebuild itself identically" >&2
    cmp -l "$OUTPUT" "$REBUILT" | sed -n '1,20p' >&2
    exit 1
fi

echo "ok: jsvm builds a byte-identical mawkcc compiler"
echo "ok: jsvm-built mawkcc rebuilds itself identically"
