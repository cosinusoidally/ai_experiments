#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
CC_BIN=$ARTIFACTS/mawkcc_orig
SELF_OBJ=$ARTIFACTS/mawkcc_self.o
SELF_GCC_OBJ=$ARTIFACTS/mawkcc_self.gcc.o
ANSI_OBJ=$ARTIFACTS/mawkcc_ansi.o
SELF_BIN=$ARTIFACTS/mawkcc.exe

mkdir -p "$ARTIFACTS"
rm -f "$CC_BIN" "$SELF_OBJ" "$SELF_GCC_OBJ" "$ANSI_OBJ" "$SELF_BIN"

cc -ansi -m32 -g -O0 "$ROOT/mawkcc_orig.c" -o "$CC_BIN"
mawk -v format=obj -f "$ROOT/cc.awk" "$ROOT/mawkcc_self.c" > "$SELF_OBJ"
cc -ansi -m32 -Dfunction=int -g -O0 -c "$ROOT/mawkcc_self.c" -o "$SELF_GCC_OBJ"
cc -ansi -m32 -g -O0 -c "$ROOT/mawkcc_ansi.c" -o "$ANSI_OBJ"
cc -m32 -no-pie "$SELF_OBJ" "$ANSI_OBJ" -o "$SELF_BIN"

for src in "$ROOT"/examples/*.c; do
    name=$(basename "$src" .c)
    AWK_BIN=$ARTIFACTS/$name.awk.bin
    C_BIN=$ARTIFACTS/$name.c.bin
    SELF_OUT=$ARTIFACTS/$name.self.bin

    rm -f "$AWK_BIN" "$C_BIN" "$SELF_OUT"
    mawk -f "$ROOT/cc.awk" "$src" > "$AWK_BIN"
    "$CC_BIN" "$src" > "$C_BIN"
    "$SELF_BIN" "$src" > "$SELF_OUT"

    if ! cmp -s "$AWK_BIN" "$C_BIN"; then
        echo "mawkcc_orig output differs from cc.awk for $src" >&2
        cmp -l "$AWK_BIN" "$C_BIN" | sed -n '1,20p' >&2
        exit 1
    fi
    if ! cmp -s "$AWK_BIN" "$SELF_OUT"; then
        echo "split mawkcc output differs from cc.awk for $src" >&2
        cmp -l "$AWK_BIN" "$SELF_OUT" | sed -n '1,20p' >&2
        exit 1
    fi
done

echo "ok: cc.awk, mawkcc_orig, and split mawkcc emit bit-identical binaries for examples"
