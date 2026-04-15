#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SPEC=$ROOT/docs/BYTECODE.md

for opcode in \
    BC_NOP \
    BC_LOAD_INT \
    BC_LOAD_STRING \
    BC_LOAD_GLOBAL \
    BC_STORE_GLOBAL \
    BC_LOAD_SLOT \
    BC_STORE_SLOT \
    BC_PUSH \
    BC_POP \
    BC_POP_DISCARD \
    BC_CALL_USER \
    BC_CALL_PRIMITIVE \
    BC_JUMP \
    BC_JUMP_IF_ZERO \
    BC_RETURN
do
    if ! grep -q "$opcode" "$SPEC"; then
        echo "missing opcode in bytecode spec: $opcode" >&2
        exit 1
    fi
done

grep -q "row width    = 16 bytes" "$SPEC"
grep -q "field width  = 4 bytes" "$SPEC"

echo "ok: bytecode spec defines initial fixed-width instruction set"
