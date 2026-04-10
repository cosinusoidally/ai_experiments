#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

for t in "$ROOT"/tests/*; do
    [ -f "$t" ] || continue
    case "$t" in
        *.sh)
            printf '== %s ==\n' "$t"
            sh "$t"
            ;;
    esac
done
