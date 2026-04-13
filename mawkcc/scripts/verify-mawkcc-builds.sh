#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts

mkdir -p "$ARTIFACTS"

AWK_BIN=$("$ROOT/scripts/build-mawkcc-awk.sh" "$ARTIFACTS/mawkcc.awk.exe")
SELF_BIN=$("$ROOT/scripts/build-mawkcc-self.sh" "$ARTIFACTS/mawkcc.self.exe")
REF_C_BIN=$("$ROOT/scripts/build-mawkcc-reference-c.sh" "$ARTIFACTS/mawkcc.reference-c.exe")
GCC_BIN=$("$ROOT/scripts/build-mawkcc-gcc.sh" "$ARTIFACTS/mawkcc.gcc-output.exe")

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
compare_to_awk reference-c "$REF_C_BIN"
compare_to_awk gcc "$GCC_BIN"

for bin in "$AWK_BIN" "$SELF_BIN" "$REF_C_BIN" "$GCC_BIN"; do
    name=$(basename "$bin" .exe)
    rebuilt=$ARTIFACTS/$name.rebuilt.exe
    "$bin" "$ROOT/mawkcc_self.c" > "$rebuilt"
    chmod +x "$rebuilt"
    if ! cmp -s "$bin" "$rebuilt"; then
        echo "$bin failed to rebuild itself identically" >&2
        cmp -l "$bin" "$rebuilt" | sed -n '1,20p' >&2
        exit 1
    fi
done

echo "ok: awk, self, reference-c, and gcc build scripts emit identical mawkcc binaries"
echo "ok: each emitted mawkcc binary rebuilds itself identically"
