#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

printf '== %s ==\n' "$ROOT/scripts/verify-mawkcc-builds.sh"
"$ROOT/scripts/verify-mawkcc-builds.sh"

for t in "$ROOT"/tests/*; do
    [ -f "$t" ] || continue
    case "$t" in
        *.sh)
            printf '== %s ==\n' "$t"
            sh "$t"
            ;;
    esac
done
