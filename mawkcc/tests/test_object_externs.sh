#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
CC_BIN=$ARTIFACTS/mawkcc_orig
MAWK_SRC=$ROOT/tests/object_externs_mawk.c
C_SRC=$ROOT/tests/object_externs_provider.c
AWK_OBJ=$ARTIFACTS/object_externs.awk.o
C_MAWK_OBJ=$ARTIFACTS/object_externs.c.o
PROVIDER_OBJ=$ARTIFACTS/object_externs_provider.o
BIN=$ARTIFACTS/object_externs

mkdir -p "$ARTIFACTS"
rm -f "$CC_BIN" "$AWK_OBJ" "$C_MAWK_OBJ" "$PROVIDER_OBJ" "$BIN"

cc -ansi -m32 -g -O0 "$ROOT/mawkcc_orig.c" -o "$CC_BIN"

mawk -f "$ROOT/cc.awk" -- -c "$MAWK_SRC" -o "$AWK_OBJ"
"$CC_BIN" -c "$MAWK_SRC" -o "$C_MAWK_OBJ"

if ! cmp -s "$AWK_OBJ" "$C_MAWK_OBJ"; then
    echo "mawkcc_orig object output differs from cc.awk for $MAWK_SRC" >&2
    cmp -l "$AWK_OBJ" "$C_MAWK_OBJ" | sed -n '1,20p' >&2
    exit 1
fi

cc -m32 -c "$C_SRC" -o "$PROVIDER_OBJ"
cc -m32 -no-pie "$PROVIDER_OBJ" "$AWK_OBJ" -o "$BIN"

set +e
"$BIN"
STATUS=$?
set -e

if [ "$STATUS" -ne 42 ]; then
    echo "unexpected linked binary status: $STATUS" >&2
    exit 1
fi

echo "ok: mawkcc object calls C function and accesses C int"
