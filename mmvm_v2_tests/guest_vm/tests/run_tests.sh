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

validate_context_demo() {
    demo_output=$1
    demo_calls=$(printf '%s\n' "$demo_output" | grep -c '^\[cx_c\] hi from cx_[ab] | call ')
    if [ "$demo_calls" -ne 100 ]; then
        echo "three-context demo emitted $demo_calls calls instead of 100" >&2
        exit 1
    fi
    printf '%s\n' "$demo_output" | grep -F \
        '[cx_c] hi from cx_a | call 1/100' >/dev/null
    printf '%s\n' "$demo_output" | grep -F \
        '[cx_c] hi from cx_b | call 100/100' >/dev/null
    printf '%s\n' "$demo_output" | grep -F \
        '[cx_c] shutdown request accepted; c_call is exiting' >/dev/null
    printf '%s\n' "$demo_output" | grep -F \
        '[embedder] cx_a and cx_b shut down after 100 multiplexed calls' >/dev/null
    echo "three-context multiplexing demo passed"
}

run_node_tests() {
    echo "guest VM host: node ($node_binary)"
    "$node_binary" guest_vm/tests/run_tests.js
    validate_context_demo "$("$node_binary" guest_vm/demos/three_contexts.js)"
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
    net_help_output=$(LD_LIBRARY_PATH="$firefox_library_directory${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
        "$js_min_binary" ./guest_runner.js net.js --help)
    case "$net_help_output" in
        *"usage: net.js"*"--directory DIRECTORY"*) ;;
        *)
            echo "guest net.js --help emitted unexpected stdout:" >&2
            echo "$net_help_output" >&2
            exit 1
            ;;
    esac
    echo "guest net.js command-line path passed"
    node_web_help_output=$(LD_LIBRARY_PATH="$firefox_library_directory${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
        "$js_min_binary" ./guest_runner.js node_web.js --help)
    case "$node_web_help_output" in
        *"usage: node_web.js"*"--directory DIRECTORY"*) ;;
        *)
            echo "guest node_web.js --help emitted unexpected stdout:" >&2
            echo "$node_web_help_output" >&2
            exit 1
            ;;
    esac
    echo "guest node_web.js command-line path passed"
    demo1_help_output=$(LD_LIBRARY_PATH="$firefox_library_directory${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
        "$js_min_binary" ./guest_runner.js demo1.js --help)
    case "$demo1_help_output" in
        *"usage: node demo1.js"*"--size WIDTHxHEIGHT"*) ;;
        *)
            echo "guest demo1.js --help emitted unexpected stdout:" >&2
            echo "$demo1_help_output" >&2
            exit 1
            ;;
    esac
    echo "guest demo1.js CommonJS command-line path passed"
    context_demo_output=$(LD_LIBRARY_PATH="$firefox_library_directory${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
        "$js_min_binary" guest_vm/demos/three_contexts.js)
    validate_context_demo "$context_demo_output"
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
