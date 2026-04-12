#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
CC_BIN=$ARTIFACTS/mawkcc_orig

mkdir -p "$ARTIFACTS"
rm -f "$CC_BIN"

cc -ansi -m32 -g -O0 "$ROOT/mawkcc_orig.c" -o "$CC_BIN"

for src in "$ROOT"/examples/*.c; do
    name=$(basename "$src" .c)
    AWK_BIN=$ARTIFACTS/$name.awk.bin
    C_BIN=$ARTIFACTS/$name.c.bin

    rm -f "$AWK_BIN" "$C_BIN"
    mawk -f "$ROOT/cc.awk" "$src" > "$AWK_BIN"
    "$CC_BIN" "$src" > "$C_BIN"

    if ! cmp -s "$AWK_BIN" "$C_BIN"; then
        echo "mawkcc_orig output differs from cc.awk for $src" >&2
        cmp -l "$AWK_BIN" "$C_BIN" | sed -n '1,20p' >&2
        exit 1
    fi
done

echo "ok: mawkcc_orig emits bit-identical binaries for examples"
