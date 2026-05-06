#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
BIN=$ARTIFACTS/param42.bin
ERR=$ARTIFACTS/param42.err

mkdir -p "$ARTIFACTS"
rm -f "$BIN" "$ERR"

mawk -f "$ROOT/cc.awk" -- "$ROOT/examples/param42.c" -o "$BIN"
chmod +x "$BIN"

set +e
"$BIN" 2>"$ERR"
STATUS=$?
set -e

if [ "$STATUS" -ne 42 ]; then
    echo "unexpected runtime status: $STATUS" >&2
    cat "$ERR" >&2
    exit 1
fi

echo "ok: parameter assignment runtime exit status 42"
