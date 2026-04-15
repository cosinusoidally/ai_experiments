#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/jsvm.gcc-output.exe}
SOURCE=${JSVM_SOURCE:-$ROOT/jsvm_self.c}
SELF_GCC_OBJ=$ARTIFACTS/jsvm_self.gcc.o
GCC_SUPPORT_OBJ=$ARTIFACTS/jsvm_gcc_support.o
GCC_BIN=$ARTIFACTS/jsvm.gcc.exe
RUN_I386=${RUN_I386:-$ROOT/scripts/run-i386.sh}

mkdir -p "$ARTIFACTS"
cc -ansi -m32 -fno-builtin -Dfunction=int -Dvar=int \
    -Wno-int-conversion -Wno-builtin-declaration-mismatch \
    -g -O0 -c "$SOURCE" -o "$SELF_GCC_OBJ"
cc -ansi -m32 -fno-builtin -g -O0 -c "$ROOT/jsvm_gcc_support.c" -o "$GCC_SUPPORT_OBJ"
cc -m32 -no-pie "$SELF_GCC_OBJ" "$GCC_SUPPORT_OBJ" -o "$GCC_BIN"
"$RUN_I386" "$GCC_BIN" "$SOURCE" > "$OUT"
chmod +x "$OUT"
printf '%s\n' "$OUT"
