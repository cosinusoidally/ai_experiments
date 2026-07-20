#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "failure: usage: $0 path-to-mawkcc-cpp" >&2
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
WORK=$(mktemp -d "$HERE/artifacts/self-host-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

CPP_OUTPUT=$WORK/mawkcc.cpp.exe
if ! "$CPP_COMPILER" "$MAWKCC/mawkcc_self.c" -o "$CPP_OUTPUT"; then
    echo "failure: C++ mawkcc could not compile $MAWKCC/mawkcc_self.c" >&2
    exit 1
fi

if ! cmp -s "$REFERENCE" "$CPP_OUTPUT"; then
    echo "failure: C++ output differs from $REFERENCE" >&2
    cmp -l "$REFERENCE" "$CPP_OUTPUT" | sed -n '1,20p' >&2
    exit 1
fi

echo "success: C++ output is byte-for-byte identical to $REFERENCE"
