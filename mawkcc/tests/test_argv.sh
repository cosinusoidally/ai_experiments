#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
BIN=$ARTIFACTS/argv90.bin
ERR=$ARTIFACTS/argv90.err

mkdir -p "$ARTIFACTS"
rm -f "$BIN" "$ERR"

mawk -f "$ROOT/cc.awk" "$ROOT/examples/argv90.c" > "$BIN"
chmod +x "$BIN"

FILE_OUT=$(file "$BIN")
case "$FILE_OUT" in
    *"ELF 32-bit LSB executable, Intel 80386"*) ;;
    *)
        echo "unexpected file output: $FILE_OUT" >&2
        exit 1
        ;;
esac

set +e
"$BIN" Z tail 2>"$ERR"
STATUS=$?
set -e

if [ "$STATUS" -ne 90 ]; then
    echo "unexpected runtime status: $STATUS" >&2
    cat "$ERR" >&2
    exit 1
fi

echo "ok: argc argv runtime exit status 90"
