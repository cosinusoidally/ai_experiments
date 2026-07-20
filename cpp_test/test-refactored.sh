#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "failure: usage: $0 path-to-refactored-mawkcc" >&2
    exit 2
fi

CPP_COMPILER=$1
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MAWKCC=$HERE/../mawkcc
REFERENCE=$MAWKCC/artifacts/mawkcc.self.exe

if [ ! -f "$REFERENCE" ]; then
    echo "failure: missing reference compiler: $REFERENCE" >&2
    echo "run scripts/build-mawkcc-self.sh from the mawkcc directory first" >&2
    exit 1
fi

mkdir -p "$HERE/artifacts"
WORK=$(mktemp -d "$HERE/artifacts/refactored-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

for source in "$MAWKCC"/examples/*.c; do
    name=$(basename "$source" .c)
    "$REFERENCE" "$source" -o "$WORK/$name.reference.exe"
    "$CPP_COMPILER" "$source" -o "$WORK/$name.refactored.exe"
    cmp "$WORK/$name.reference.exe" "$WORK/$name.refactored.exe"
done

"$REFERENCE" -c "$HERE/tests/object_external.c" -o "$WORK/reference.o"
"$CPP_COMPILER" -c "$HERE/tests/object_external.c" -o "$WORK/refactored.o"
cmp "$WORK/reference.o" "$WORK/refactored.o"

if "$CPP_COMPILER" "$HERE/tests/invalid_break.c" -o "$WORK/invalid-break.exe" \
    2>"$WORK/invalid-break.err"; then
    echo "failure: break outside a loop was accepted" >&2
    exit 1
fi
grep -F '`break` used outside of a loop' "$WORK/invalid-break.err" >/dev/null

if "$CPP_COMPILER" "$HERE/tests/invalid_mkc.c" -o "$WORK/invalid-mkc.exe" \
    2>"$WORK/invalid-mkc.err"; then
    echo "failure: empty mkC literal was accepted" >&2
    exit 1
fi
grep -F '`mkC` expects exactly one character' "$WORK/invalid-mkc.err" >/dev/null

echo "success: refactored executable, object, and diagnostic regressions passed"
