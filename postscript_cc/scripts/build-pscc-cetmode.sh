#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
    echo "usage: build-pscc-cetmode.sh source output" >&2
    exit 2
fi

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SRC=$1
OUT=$2
GS_BIN=${GS_BIN:-gs}

"$GS_BIN" -q -dNODISPLAY -dCETMODE -dNOSAFER \
    -sSOURCE="$SRC" \
    -sOUT="$OUT" \
    "$ROOT/pscc.ps"
chmod +x "$OUT"
