#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
RUN_I386=${RUN_I386:-$ROOT/scripts/run-i386.sh}

mkdir -p "$ARTIFACTS"

JSVM_BIN=$("$ROOT/scripts/build-jsvm-awk.sh" "$ARTIFACTS/jsvm.js-mode-seed.exe")
REFERENCE=$ARTIFACTS/jsvm.js-mode-reference.exe
OUTPUT=$ARTIFACTS/jsvm.js-mode.exe

"$ROOT/scripts/build-jsvm-awk.sh" "$REFERENCE" >/dev/null

cd "$ROOT"
"$RUN_I386" "$JSVM_BIN" --js "$ROOT/jsvm_self.c" -- "$ROOT/jsvm_self.c" -o "$OUTPUT"
chmod +x "$OUTPUT"

if ! cmp -s "$REFERENCE" "$OUTPUT"; then
    echo "jsvm --js self compile output differs from reference jsvm" >&2
    cmp -l "$REFERENCE" "$OUTPUT" | sed -n '1,20p' >&2
    exit 1
fi

echo "ok: jsvm --js jsvm_self.c builds byte-identical jsvm executable"
