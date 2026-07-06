#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
PSCC=$ROOT/scripts/build-pscc.sh
MAWKCC_ROOT=$ROOT/../mawkcc

mkdir -p "$ARTIFACTS"

RET_BIN=$ARTIFACTS/ret42.pscc.exe
RET_REF=$ARTIFACTS/ret42.mawkcc.exe
HELLO_BIN=$ARTIFACTS/hello.pscc.exe
HELLO_REF=$ARTIFACTS/hello.mawkcc.exe
HELLO_OUT=$ARTIFACTS/hello.out
IF_BIN=$ARTIFACTS/if_chain.pscc.exe
IF_REF=$ARTIFACTS/if_chain.mawkcc.exe

rm -f "$RET_BIN" "$RET_REF" "$HELLO_BIN" "$HELLO_REF" "$HELLO_OUT" \
    "$IF_BIN" "$IF_REF"

"$PSCC" "$ROOT/examples/ret42.c" "$RET_BIN"
mawk -f "$MAWKCC_ROOT/cc.awk" -- "$ROOT/examples/ret42.c" -o "$RET_REF"
cmp "$RET_BIN" "$RET_REF"

set +e
"$RET_BIN"
RET_STATUS=$?
set -e

if [ "$RET_STATUS" -ne 42 ]; then
    echo "unexpected ret42 status: $RET_STATUS" >&2
    exit 1
fi

"$PSCC" "$ROOT/examples/hello_write.c" "$HELLO_BIN"
mawk -f "$MAWKCC_ROOT/cc.awk" -- "$ROOT/examples/hello_write.c" -o "$HELLO_REF"
cmp "$HELLO_BIN" "$HELLO_REF"

"$HELLO_BIN" >"$HELLO_OUT"
if [ "$(cat "$HELLO_OUT")" != "hello" ]; then
    echo "unexpected hello stdout" >&2
    od -An -tx1 -v "$HELLO_OUT" >&2
    exit 1
fi

"$PSCC" "$ROOT/examples/if_chain.c" "$IF_BIN"
mawk -f "$MAWKCC_ROOT/cc.awk" -- "$ROOT/examples/if_chain.c" -o "$IF_REF"
cmp "$IF_BIN" "$IF_REF"

echo "ok: pscc matches mawkcc on ret42, hello_write, and if_chain"
