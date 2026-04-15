#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
SOURCE=${JSVM_SOURCE:-$ROOT/jsvm_self.c}
RUN_I386=${RUN_I386:-$ROOT/scripts/run-i386.sh}

mkdir -p "$ARTIFACTS"

AWK_BIN=$("$ROOT/scripts/build-jsvm-awk.sh" "$ARTIFACTS/jsvm.awk.exe")
SELF_BIN=$("$ROOT/scripts/build-jsvm-self.sh" "$ARTIFACTS/jsvm.self.exe")
GCC_BIN=$("$ROOT/scripts/build-jsvm-gcc.sh" "$ARTIFACTS/jsvm.gcc-output.exe")
JS_BIN=$("$ROOT/scripts/build-jsvm-js.sh" "$ARTIFACTS/jsvm.js.exe")

compare_to_awk() {
    label=$1
    path=$2
    if ! cmp -s "$AWK_BIN" "$path"; then
        echo "$label build differs from awk build" >&2
        cmp -l "$AWK_BIN" "$path" | sed -n '1,20p' >&2
        exit 1
    fi
}

compare_to_awk self "$SELF_BIN"
compare_to_awk gcc "$GCC_BIN"
compare_to_awk js "$JS_BIN"

for bin in "$AWK_BIN" "$SELF_BIN" "$GCC_BIN" "$JS_BIN"; do
    name=$(basename "$bin" .exe)
    rebuilt=$ARTIFACTS/$name.rebuilt.exe
    "$RUN_I386" "$bin" "$SOURCE" > "$rebuilt"
    chmod +x "$rebuilt"
    if ! cmp -s "$bin" "$rebuilt"; then
        echo "$bin failed to rebuild itself identically" >&2
        cmp -l "$bin" "$rebuilt" | sed -n '1,20p' >&2
        exit 1
    fi
done

echo "ok: awk, self, gcc, and js build scripts emit identical jsvm binaries"
echo "ok: each emitted jsvm binary rebuilds itself identically"
