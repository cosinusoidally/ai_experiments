#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/tcc-extract-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

tarball=${1:-"$root/tcc-0.9.27.tar.bz2"}

mkdir -p "$tmp/real" "$tmp/awk"

tar -xjf "$tarball" -C "$tmp/real"
(
    cd "$root"
    mawk -f "$root/extract-tarball.awk" "$tarball" "$tmp/awk" >/dev/null
)

real_meta=$tmp/real.meta
awk_meta=$tmp/awk.meta

find "$tmp/real" -printf '%P|%y|%m|%s\n' | sort > "$real_meta"
find "$tmp/awk" -printf '%P|%y|%m|%s\n' | sort > "$awk_meta"

diff -u "$real_meta" "$awk_meta"
diff -qr "$tmp/real" "$tmp/awk"

printf 'extract-tar.awk matches tar for %s\n' "$tarball"
