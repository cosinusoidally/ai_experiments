#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
GS_BIN=${GS_BIN:-gs}
MODE=${1:-expect-bug}
PS=$ROOT/tests/gs854_u32_and.ps
OUT=${TMPDIR:-/tmp}/gs854_u32_and.out
ERR=${TMPDIR:-/tmp}/gs854_u32_and.err

rm -f "$OUT" "$ERR"

set +e
"$GS_BIN" -q -dNODISPLAY "$PS" >"$OUT" 2>"$ERR"
STATUS=$?
set -e

if grep -q 'typecheck in --and--' "$OUT" "$ERR"; then
    OBSERVED=bug
else
    OBSERVED=ok
fi

case "$MODE" in
    expect-bug)
        [ "$OBSERVED" = bug ]
        echo "ok: observed Ghostscript u32/and typecheck bug"
        ;;
    expect-ok)
        [ "$OBSERVED" = ok ]
        echo "ok: Ghostscript handled u32/and without the old typecheck bug"
        ;;
    *)
        echo "usage: test_gs854_u32_and.sh [expect-bug|expect-ok]" >&2
        exit 2
        ;;
esac
