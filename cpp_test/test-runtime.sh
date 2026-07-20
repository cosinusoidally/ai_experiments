#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "failure: usage: $0 path-to-refactored-mawkcc" >&2
    exit 2
fi

COMPILER=$1
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
EXAMPLES=$HERE/../mawkcc/examples
WORK=$(mktemp -d "$HERE/artifacts/runtime-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

run_and_expect() {
    source=$1
    expected=$2
    executable=$WORK/$(basename "$source" .c).exe
    "$COMPILER" "$source" -o "$executable"
    chmod +x "$executable"
    status=0
    "$executable" || status=$?
    if [ "$status" -ne "$expected" ]; then
        echo "failure: $(basename "$source") returned $status, expected $expected" >&2
        exit 1
    fi
}

run_and_expect "$EXAMPLES/ret42.c" 42
run_and_expect "$EXAMPLES/brk42.c" 42
run_and_expect "$EXAMPLES/param42.c" 42
run_and_expect "$EXAMPLES/exit33.c" 33
run_and_expect "$EXAMPLES/partial_return.c" 0

echo "success: generated i386 executables passed runtime checks"
