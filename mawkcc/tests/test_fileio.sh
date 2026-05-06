#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
BIN=$ARTIFACTS/fileio42.bin
ERR=$ARTIFACTS/fileio42.err
OUTFILE=$ARTIFACTS/io42.dat

mkdir -p "$ARTIFACTS"
rm -f "$BIN" "$ERR" "$OUTFILE"

mawk -f "$ROOT/cc.awk" -- "$ROOT/examples/fileio42.c" -o "$BIN"
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

HEX=$(od -An -tx1 -v "$OUTFILE" | tr -d ' \n')
if [ "$HEX" != "2a" ]; then
    echo "unexpected file contents: $HEX" >&2
    exit 1
fi

echo "ok: file io runtime exit status 42"
