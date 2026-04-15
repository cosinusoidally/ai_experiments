#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
SRC=$ROOT/examples/ret42.c
SELF_BIN=$ARTIFACTS/mawkcc.exe
CC_BIN=$ARTIFACTS/mawkcc_orig.output-flag
AWK_STDOUT=$ARTIFACTS/output_flag.awk.stdout.bin
AWK_OUT=$ARTIFACTS/output_flag.awk.o_flag.bin
C_STDOUT=$ARTIFACTS/output_flag.c.stdout.bin
C_OUT=$ARTIFACTS/output_flag.c.o_flag.bin
SELF_STDOUT=$ARTIFACTS/output_flag.self.stdout.bin
SELF_OUT=$ARTIFACTS/output_flag.self.o_flag.bin
OBJ_SRC=$ARTIFACTS/output_flag_obj.c
AWK_OBJ=$ARTIFACTS/output_flag.awk.o
C_OBJ=$ARTIFACTS/output_flag.c.o
SELF_OBJ=$ARTIFACTS/output_flag.self.o
ERR=$ARTIFACTS/output_flag.err

mkdir -p "$ARTIFACTS"
rm -f "$CC_BIN" "$AWK_STDOUT" "$AWK_OUT" "$C_STDOUT" "$C_OUT" \
    "$SELF_STDOUT" "$SELF_OUT" "$OBJ_SRC" "$AWK_OBJ" "$C_OBJ" "$SELF_OBJ" "$ERR"

cc -ansi -m32 -g -O0 "$ROOT/mawkcc_orig.c" -o "$CC_BIN"

mawk -f "$ROOT/cc.awk" "$SRC" > "$AWK_STDOUT"
mawk -f "$ROOT/cc.awk" -- -o "$AWK_OUT" "$SRC"
"$CC_BIN" "$SRC" > "$C_STDOUT"
"$CC_BIN" -o "$C_OUT" "$SRC"
"$SELF_BIN" "$SRC" > "$SELF_STDOUT"
"$SELF_BIN" -o "$SELF_OUT" "$SRC"

cmp -s "$AWK_STDOUT" "$AWK_OUT"
cmp -s "$AWK_STDOUT" "$C_STDOUT"
cmp -s "$AWK_STDOUT" "$C_OUT"
cmp -s "$AWK_STDOUT" "$SELF_STDOUT"
cmp -s "$AWK_STDOUT" "$SELF_OUT"

chmod +x "$SELF_OUT"
set +e
"$SELF_OUT" 2>"$ERR"
STATUS=$?
set -e
if [ "$STATUS" -ne 42 ]; then
    echo "unexpected -o runtime status: $STATUS" >&2
    cat "$ERR" >&2
    exit 1
fi

cat > "$OBJ_SRC" <<'EOF'
function answer() {
    return 42;
}
EOF

mawk -f "$ROOT/cc.awk" -- -c -o "$AWK_OBJ" "$OBJ_SRC"
"$CC_BIN" -c -o "$C_OBJ" "$OBJ_SRC"
"$SELF_BIN" -c -o "$SELF_OBJ" "$OBJ_SRC"

cmp -s "$AWK_OBJ" "$C_OBJ"
cmp -s "$AWK_OBJ" "$SELF_OBJ"

echo "ok: -o writes executable and object outputs matching stdout"
