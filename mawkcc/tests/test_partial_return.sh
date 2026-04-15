#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
BIN=$ARTIFACTS/partial_return.bin

mkdir -p "$ARTIFACTS"
rm -f "$BIN"

mawk -f "$ROOT/cc.awk" -- "$ROOT/examples/partial_return.c" -o "$BIN"
chmod +x "$BIN"

set +e
"$BIN"
status=$?
set -e

if [ "$status" -ne 0 ]; then
    echo "partial return runtime exit status $status, expected 0" >&2
    exit 1
fi

echo "ok: functions with partial early returns still emit a trailing epilogue"
