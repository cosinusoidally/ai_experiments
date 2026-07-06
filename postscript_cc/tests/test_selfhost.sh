#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
PSCC=$ROOT/scripts/build-pscc.sh
MAWKCC_ROOT=$ROOT/../mawkcc

mkdir -p "$ARTIFACTS"

PSCC_SELF=$ARTIFACTS/mawkcc.pscc.exe
PSCC_SELF_REF=$MAWKCC_ROOT/artifacts/mawkcc.self.exe
SELF_OUT=$ARTIFACTS/mawkcc.self.exe

rm -f "$PSCC_SELF" "$SELF_OUT"

"$PSCC" "$MAWKCC_ROOT/mawkcc_self.c" "$PSCC_SELF"
cmp "$PSCC_SELF" "$PSCC_SELF_REF"

"$PSCC_SELF" "$MAWKCC_ROOT/mawkcc_self.c" -o "$SELF_OUT"
cmp "$SELF_OUT" "$PSCC_SELF_REF"

echo "ok: pscc self-host output matches mawkcc reference"
