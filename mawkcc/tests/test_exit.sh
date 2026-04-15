#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
BIN=$ARTIFACTS/exit33.bin

mkdir -p "$ARTIFACTS"
rm -f "$BIN"

mawk -f "$ROOT/cc.awk" -- "$ROOT/examples/exit33.c" -o "$BIN"
chmod +x "$BIN"

set +e
"$BIN"
STATUS=$?
set -e

if [ "$STATUS" -ne 33 ]; then
    echo "unexpected exit runtime status: $STATUS" >&2
    exit 1
fi

echo "ok: exit runtime status 33"
