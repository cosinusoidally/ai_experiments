#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
CC_BIN=$ARTIFACTS/mawkcc_orig
SELF_OBJ=$ARTIFACTS/mawkcc_self.o
SELF_GCC_OBJ=$ARTIFACTS/mawkcc_self.gcc.o
ANSI_OBJ=$ARTIFACTS/mawkcc_ansi.o
SELF_BIN=$ARTIFACTS/mawkcc.exe
OBJ_SRC=$ARTIFACTS/parity_obj.c
AWK_OBJ_OUT=$ARTIFACTS/parity_obj.awk.o
C_OBJ_OUT=$ARTIFACTS/parity_obj.c.o
SELF_OBJ_OUT=$ARTIFACTS/parity_obj.self.o

mkdir -p "$ARTIFACTS"
rm -f "$CC_BIN" "$SELF_OBJ" "$SELF_GCC_OBJ" "$ANSI_OBJ" "$SELF_BIN" \
    "$OBJ_SRC" "$AWK_OBJ_OUT" "$C_OBJ_OUT" "$SELF_OBJ_OUT"

cc -ansi -m32 -g -O0 "$ROOT/mawkcc_orig.c" -o "$CC_BIN"
mawk -v format=obj -f "$ROOT/cc.awk" "$ROOT/mawkcc_self.c" > "$SELF_OBJ"
cc -ansi -m32 -Dfunction=int -g -O0 -c "$ROOT/mawkcc_self.c" -o "$SELF_GCC_OBJ"
cc -ansi -m32 -g -O0 -c "$ROOT/mawkcc_ansi.c" -o "$ANSI_OBJ"
cc -m32 -no-pie "$SELF_OBJ" "$ANSI_OBJ" -o "$SELF_BIN"

for src in "$ROOT"/examples/*.c; do
    name=$(basename "$src" .c)
    AWK_BIN=$ARTIFACTS/$name.awk.bin
    C_BIN=$ARTIFACTS/$name.c.bin
    SELF_OUT=$ARTIFACTS/$name.self.bin

    rm -f "$AWK_BIN" "$C_BIN" "$SELF_OUT"
    mawk -f "$ROOT/cc.awk" "$src" > "$AWK_BIN"
    "$CC_BIN" "$src" > "$C_BIN"
    "$SELF_BIN" "$src" > "$SELF_OUT"

    if ! cmp -s "$AWK_BIN" "$C_BIN"; then
        echo "mawkcc_orig output differs from cc.awk for $src" >&2
        cmp -l "$AWK_BIN" "$C_BIN" | sed -n '1,20p' >&2
        exit 1
    fi
    if ! cmp -s "$AWK_BIN" "$SELF_OUT"; then
        echo "split mawkcc output differs from cc.awk for $src" >&2
        cmp -l "$AWK_BIN" "$SELF_OUT" | sed -n '1,20p' >&2
        exit 1
    fi
done

cat > "$OBJ_SRC" <<'EOF'
function answer() {
    return 42;
}
EOF

mawk -v format=obj -f "$ROOT/cc.awk" "$OBJ_SRC" > "$AWK_OBJ_OUT"
"$CC_BIN" -c "$OBJ_SRC" > "$C_OBJ_OUT"
"$SELF_BIN" -c "$OBJ_SRC" > "$SELF_OBJ_OUT"

if ! cmp -s "$AWK_OBJ_OUT" "$C_OBJ_OUT"; then
    echo "mawkcc_orig object output differs from cc.awk for $OBJ_SRC" >&2
    cmp -l "$AWK_OBJ_OUT" "$C_OBJ_OUT" | sed -n '1,20p' >&2
    exit 1
fi
if ! cmp -s "$AWK_OBJ_OUT" "$SELF_OBJ_OUT"; then
    echo "split mawkcc object output differs from cc.awk for $OBJ_SRC" >&2
    cmp -l "$AWK_OBJ_OUT" "$SELF_OBJ_OUT" | sed -n '1,20p' >&2
    exit 1
fi

echo "ok: cc.awk, mawkcc_orig, and split mawkcc emit bit-identical executable and object outputs"
