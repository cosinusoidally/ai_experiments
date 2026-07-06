#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
    echo "usage: build-pscc.sh source output" >&2
    exit 2
fi

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SRC=$1
OUT=$2

cat "$SRC" | gs -q -dNODISPLAY "$ROOT/pscc.ps" >"$OUT"
chmod +x "$OUT"
