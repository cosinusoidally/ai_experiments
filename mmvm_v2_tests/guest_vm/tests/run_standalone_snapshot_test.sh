#!/bin/sh
set -eu

test_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
suite_directory=$(CDPATH= cd -- "$test_directory/../.." && pwd)
workspace_directory=$(CDPATH= cd -- "$suite_directory/../.." && pwd)
js_min_binary=${JS_MIN_BINARY:-"$workspace_directory/mmvm_v2/artifacts/js_min.exe"}
firefox_library_directory=${FIREFOX_LIB_DIR:-"$workspace_directory/firefox-1.0.8/lib"}

mkdir -p "$suite_directory/artifacts"
temporary_directory=$(mktemp -d \
    "$suite_directory/artifacts/standalone-test.XXXXXX")
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM

cd "$suite_directory"
gcc -ansi -m32 js_runner.c \
    -o "$temporary_directory/js_runner.exe" -ldl

LD_LIBRARY_PATH="$firefox_library_directory${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$js_min_binary" guest_runner.js --vm-native \
    --snapshot "$temporary_directory/snap-a" hello.js >/dev/null
LD_LIBRARY_PATH="$firefox_library_directory${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$js_min_binary" guest_runner.js --vm-native \
    --snapshot "$temporary_directory/snap-b" hello.js >/dev/null

cmp "$temporary_directory/snap-a" "$temporary_directory/snap-b"
standalone_output=$("$temporary_directory/js_runner.exe" \
    "$temporary_directory/snap-a" hello.js)
if [ "$standalone_output" != "Hello, world!" ]; then
    echo "standalone snapshot emitted unexpected stdout:" >&2
    echo "$standalone_output" >&2
    exit 1
fi

set +e
"$temporary_directory/js_runner.exe" "$temporary_directory/snap-a" \
    wrong-program.js >/dev/null 2>&1
wrong_program_status=$?
set -e
if [ "$wrong_program_status" -ne 64 ]; then
    echo "standalone snapshot accepted the wrong program name" >&2
    exit 1
fi

LD_LIBRARY_PATH="$firefox_library_directory${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    "$js_min_binary" guest_runner.js --vm-native \
    --snapshot "$temporary_directory/runner-snap" guest_runner.js \
    --vm-native --snapshot "$temporary_directory/runner-snap2" \
    hello.js >/dev/null
fixed_point_output=$("$temporary_directory/js_runner.exe" \
    "$temporary_directory/runner-snap" guest_runner.js --vm-native \
    --snapshot "$temporary_directory/runner-snap2" hello.js)
if [ "$fixed_point_output" != "Hello, world!" ]; then
    echo "fixed-point runner emitted unexpected stdout:" >&2
    echo "$fixed_point_output" >&2
    exit 1
fi
cmp "$temporary_directory/runner-snap" \
    "$temporary_directory/runner-snap2"

echo "standalone snapshot hello and byte-identical fixed point passed"
