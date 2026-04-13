#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/mawkcc.gcc-output.exe}
SELF_GCC_OBJ=$ARTIFACTS/mawkcc_self.gcc.o
GCC_SUPPORT_OBJ=$ARTIFACTS/mawkcc_gcc_support.o
GCC_BIN=$ARTIFACTS/mawkcc.gcc.exe

mkdir -p "$ARTIFACTS"
cc -ansi -m32 -fno-builtin -Dfunction=int -Dvar=int \
    -Wno-int-conversion -Wno-builtin-declaration-mismatch \
    -g -O0 -c "$ROOT/mawkcc_self.c" -o "$SELF_GCC_OBJ"
cc -ansi -m32 -fno-builtin -g -O0 -c "$ROOT/mawkcc_gcc_support.c" -o "$GCC_SUPPORT_OBJ"
cc -m32 -no-pie "$SELF_GCC_OBJ" "$GCC_SUPPORT_OBJ" -o "$GCC_BIN"
"$GCC_BIN" -p 262144 "$ROOT/mawkcc_self.c" > "$OUT"
chmod +x "$OUT"
printf '%s\n' "$OUT"
