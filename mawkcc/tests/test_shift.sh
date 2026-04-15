#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
BIN=$ARTIFACTS/shift42.bin

mkdir -p "$ARTIFACTS"
rm -f "$BIN"

mawk -f "$ROOT/cc.awk" -- "$ROOT/examples/shift42.c" -o "$BIN"
chmod +x "$BIN"

set +e
"$BIN"
STATUS=$?
set -e

if [ "$STATUS" -ne 46 ]; then
    echo "unexpected shift runtime status: $STATUS" >&2
    exit 1
fi

echo "ok: shl/shr/mod runtime exit status 46"
