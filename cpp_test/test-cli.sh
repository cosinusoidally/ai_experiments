#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    echo "failure: usage: $0 path-to-refactored-mawkcc" >&2
    exit 2
fi

COMPILER=$1
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WORK=$(mktemp -d "$HERE/artifacts/cli-test.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM

if "$COMPILER" 2>"$WORK/no-args.err"; then
    echo "failure: compiler accepted a missing source" >&2
    exit 1
fi
grep -F 'usage:' "$WORK/no-args.err" >/dev/null

if "$COMPILER" -o 2>"$WORK/missing-output.err"; then
    echo "failure: compiler accepted -o without a path" >&2
    exit 1
fi
grep -F 'usage:' "$WORK/missing-output.err" >/dev/null

if "$COMPILER" "$WORK/missing.c" 2>"$WORK/missing-source.err"; then
    echo "failure: compiler accepted a missing source file" >&2
    exit 1
fi
grep -F 'cannot open' "$WORK/missing-source.err" >/dev/null

SOURCE=$HERE/../mawkcc/examples/ret42.c
"$COMPILER" "$SOURCE" >"$WORK/stdout.exe"
"$COMPILER" "$SOURCE" -o "$WORK/file.exe"
cmp "$WORK/stdout.exe" "$WORK/file.exe"

if "$COMPILER" "$SOURCE" -o "$WORK/missing/output.exe" \
    2>"$WORK/output.err"; then
    echo "failure: compiler wrote through a missing output directory" >&2
    exit 1
fi
grep -F 'cannot open output' "$WORK/output.err" >/dev/null

echo "success: command-line and file I/O checks passed"
