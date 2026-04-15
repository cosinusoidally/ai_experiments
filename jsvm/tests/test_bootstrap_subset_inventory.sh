#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
EXPECTED=$ROOT/fixtures/mawkcc_bootstrap_subset.txt
ACTUAL=$ROOT/artifacts/mawkcc_bootstrap_subset.actual.txt

mkdir -p "$ROOT/artifacts"
"$ROOT/scripts/inventory-bootstrap-subset.sh" "$ROOT/jsvm_self.c" > "$ACTUAL"

if ! cmp -s "$EXPECTED" "$ACTUAL"; then
    echo "bootstrap subset inventory changed" >&2
    diff -u "$EXPECTED" "$ACTUAL" >&2
    exit 1
fi

echo "ok: bootstrap subset inventory matches fixture"
