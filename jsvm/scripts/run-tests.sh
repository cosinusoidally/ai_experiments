#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

for t in "$ROOT"/tests/*.sh; do
    [ -f "$t" ] || continue
    printf '== %s ==\n' "$t"
    sh "$t"
done
