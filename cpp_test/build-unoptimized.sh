#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD_DIR=$HERE/artifacts/unoptimized

cmake -S "$HERE" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Unoptimized
cmake --build "$BUILD_DIR" --target mawkcc_cpp mawkcc_cpp_original "$@"
