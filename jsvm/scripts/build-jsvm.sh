#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
OUT=${1:-$ARTIFACTS/jsvm.exe}
ROUTE=${JSVM_BUILD_ROUTE:-awk}

mkdir -p "$ARTIFACTS"
case "$ROUTE" in
    awk)
        "$ROOT/scripts/build-jsvm-awk.sh" "$OUT"
        ;;
    self)
        "$ROOT/scripts/build-jsvm-self.sh" "$OUT"
        ;;
    gcc)
        "$ROOT/scripts/build-jsvm-gcc.sh" "$OUT"
        ;;
    js)
        "$ROOT/scripts/build-jsvm-js.sh" "$OUT"
        ;;
    *)
        echo "unknown JSVM_BUILD_ROUTE: $ROUTE" >&2
        exit 2
        ;;
esac
