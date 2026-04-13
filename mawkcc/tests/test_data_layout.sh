#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
BIN=$ARTIFACTS/string_then_global.bin

mkdir -p "$ARTIFACTS"
rm -f "$BIN"

mawk -f "$ROOT/cc.awk" "$ROOT/examples/string_then_global.c" > "$BIN"
chmod +x "$BIN"

set +e
"$BIN"
status=$?
set -e

if [ "$status" -ne 126 ]; then
    echo "string/global data layout runtime exit status $status, expected 126" >&2
    exit 1
fi

echo "ok: strings emitted before later globals do not overlap global storage"
