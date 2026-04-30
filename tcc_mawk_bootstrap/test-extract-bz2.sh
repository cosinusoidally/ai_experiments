#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/tcc-bz2-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

tarball=${1:-"$root/tcc-0.9.27.tar.bz2"}
ref=$tmp/ref.tar
out=$tmp/out.tar

bunzip2 -c "$tarball" > "$ref"
(
    cd "$root"
    mawk -f "$root/extract-bz2.awk" "$tarball" "$out" >/dev/null
)

cmp -s "$ref" "$out"

printf 'extract-bz2.awk matches bunzip2 for %s\n' "$tarball"
