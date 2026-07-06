#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

"$ROOT/tests/test_smoke.sh"
"$ROOT/tests/test_selfhost.sh"
