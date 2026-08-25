#!/bin/sh
set -eu

test_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
suite_directory=$(CDPATH= cd -- "$test_directory/../.." && pwd)
workspace_directory=$(CDPATH= cd -- "$suite_directory/../.." && pwd)

host=${1:-both}
if [ "$host" = "--host" ]; then
    if [ "$#" -lt 2 ]; then
        echo "usage: run_tests.sh [--host] node|js_min|both" >&2
        exit 2
    fi
    host=$2
fi

node_binary=${NODE_BINARY:-node}
js_min_binary=${JS_MIN_BINARY:-"$workspace_directory/mmvm_v2/artifacts/js_min.exe"}
firefox_library_directory=${FIREFOX_LIB_DIR:-"$workspace_directory/firefox-1.0.8/lib"}

run_node_tests() {
    echo "guest VM host: node ($node_binary)"
    "$node_binary" guest_vm/tests/run_tests.js
}

run_js_min_tests() {
    echo "guest VM host: js_min ($js_min_binary)"
    LD_LIBRARY_PATH="$firefox_library_directory${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
        "$js_min_binary" guest_vm/tests/run_tests.js
    hello_output=$(LD_LIBRARY_PATH="$firefox_library_directory${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
        "$js_min_binary" ./guest_runner.js hello.js)
    if [ "$hello_output" != "Hello, world!" ]; then
        echo "guest_runner.js emitted unexpected stdout:" >&2
        echo "$hello_output" >&2
        exit 1
    fi
    echo "$hello_output"
    echo "guest runner stdout passed"
}

cd "$suite_directory"
case "$host" in
    node)
        run_node_tests
        ;;
    js_min)
        run_js_min_tests
        ;;
    both)
        run_node_tests
        run_js_min_tests
        ;;
    *)
        echo "usage: run_tests.sh [--host] node|js_min|both" >&2
        exit 2
        ;;
esac
