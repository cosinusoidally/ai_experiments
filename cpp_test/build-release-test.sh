#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUILD_DIR=$HERE/artifacts/release

"$HERE/build-release.sh" "$@"
cmake --build "$BUILD_DIR" --target mawkcc_test_binaries "$@"
