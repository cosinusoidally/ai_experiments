#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts
CC_BIN=$ARTIFACTS/mawkcc_orig
SRC=$ARTIFACTS/link_answer.c
DRIVER_SRC=$ARTIFACTS/link_driver.c
AWK_OBJ=$ARTIFACTS/link_answer.awk.o
C_OBJ=$ARTIFACTS/link_answer.c.o
DRIVER_OBJ=$ARTIFACTS/link_driver.o
BIN=$ARTIFACTS/link_answer

mkdir -p "$ARTIFACTS"
rm -f "$CC_BIN" "$SRC" "$DRIVER_SRC" "$AWK_OBJ" "$C_OBJ" "$DRIVER_OBJ" "$BIN"

cc -ansi -m32 -g -O0 "$ROOT/mawkcc_orig.c" -o "$CC_BIN"

cat > "$SRC" <<'EOF'
function answer() {
    return 42;
}
EOF

cat > "$DRIVER_SRC" <<'EOF'
extern int answer(void);

int main(void)
{
    return answer();
}
EOF

mawk -v format=obj -f "$ROOT/cc.awk" "$SRC" > "$AWK_OBJ"
"$CC_BIN" -c "$SRC" > "$C_OBJ"

if ! cmp -s "$AWK_OBJ" "$C_OBJ"; then
    echo "mawkcc_orig object output differs from cc.awk for $SRC" >&2
    cmp -l "$AWK_OBJ" "$C_OBJ" | sed -n '1,20p' >&2
    exit 1
fi

cc -m32 -c "$DRIVER_SRC" -o "$DRIVER_OBJ"
cc -m32 "$DRIVER_OBJ" "$AWK_OBJ" -o "$BIN"

set +e
"$BIN"
STATUS=$?
set -e

if [ "$STATUS" -ne 42 ]; then
    echo "unexpected linked binary status: $STATUS" >&2
    exit 1
fi

echo "ok: mawkcc object links with gcc object and exits 42"
