#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
artifacts=$root/artifacts/airlock-bootstrap-stage2
rootfs=$artifacts/rootfs
work=$artifacts/work
initrd_gz=$root/../../slackware-10.2/iso/isolinux/initrd.img
seed_bootstrap=$root/artifacts/bootstrap-i386-mawk
seed_tcc=$seed_bootstrap/stage2/tcc
seed_tccdir=$seed_bootstrap/common/lib/tcc
tarball_bz2=$root/tcc-0.9.27.tar.bz2
musl_tarball=$root/musl-1.1.24.tar.gz
bootstrappable_h=$root/M2libc/bootstrappable.h
bootstrappable_c=$root/M2libc/bootstrappable.c
woody_mawk=/home/foo/src/woody_mawk/mawk

if [ ! -x "$seed_tcc" ] || [ ! -d "$seed_tccdir/include" ]; then
  printf 'missing seed stage2 tcc; run bootstrap-i386-mawk.awk first\n' >&2
  exit 1
fi

rm -rf "$artifacts"
mkdir -p "$rootfs" "$work" "$work/musl-bits" "$work/seed-headers/sys" "$work/src/M2libc"

tmp_img=$artifacts/initrd.ext2
gzip -dc "$initrd_gz" > "$tmp_img"
debugfs -R "rdump / $rootfs" "$tmp_img" >/dev/null 2>"$artifacts/debugfs-rdump.err"
mkdir -p "$rootfs/work"

tmp_musl=$artifacts/musl-host
mkdir -p "$tmp_musl"
tar -xzf "$musl_tarball" -C "$tmp_musl"
mkdir -p "$work/musl-bits"
sed -f "$tmp_musl/musl-1.1.24/tools/mkalltypes.sed" \
  "$tmp_musl/musl-1.1.24/arch/i386/bits/alltypes.h.in" \
  "$tmp_musl/musl-1.1.24/include/alltypes.h.in" \
  > "$work/musl-bits/alltypes.h"
cp -f "$tmp_musl/musl-1.1.24/arch/i386/bits/syscall.h.in" "$work/musl-bits/syscall.h"
sed -n -e 's/__NR_/SYS_/p' "$tmp_musl/musl-1.1.24/arch/i386/bits/syscall.h.in" >> "$work/musl-bits/syscall.h"

cp -f "$seed_tcc" "$work/tcc-seed"
mkdir -p "$work/seed-tccdir/include"
cp -f "$seed_tccdir/include/"*.h "$work/seed-tccdir/include/"

cp -f "$root/unbz2.c" "$work/src/unbz2.c"
cp -f "$root/untar.c" "$work/src/untar.c"
cp -f "$bootstrappable_h" "$work/src/M2libc/bootstrappable.h"
cp -f "$bootstrappable_c" "$work/src/M2libc/bootstrappable.c"
cp -f "$tarball_bz2" "$work/tcc-0.9.27.tar.bz2"
cp -f "$musl_tarball" "$work/musl-1.1.24.tar.gz"
mkdir -p "$rootfs/usr/bin"
cp -f "$woody_mawk" "$rootfs/usr/bin/mawk"
chmod 0755 "$rootfs/usr/bin/mawk"
cp -Rf "$root/airlock/seed-headers/." "$work/seed-headers/"
cp -f "$root/airlock/crt.c" "$work/crt.c"
cp -f "$root/airlock/inside-airlock.sh.in" "$work/inside-airlock.sh"

chmod 0755 "$work/inside-airlock.sh"
sed -i \
  -e "s|__HOST_COMMON_TCCDIR__|$work/bootstrap/common/lib/tcc|g" \
  -e "s|__HOST_CRT_PREFIX__|/usr/lib32:/lib32:/usr/lib/i386-linux-gnu:/lib/i386-linux-gnu|g" \
  -e "s|__HOST_LIB_PATHS__|/usr/lib32:/lib32:/usr/lib/i386-linux-gnu:/lib/i386-linux-gnu|g" \
  -e "s|__HOST_LIBC_SO__|/usr/lib32/libc.so.6|g" \
  "$work/inside-airlock.sh"

bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/inside-airlock.sh

cmp -s "$work/bootstrap/stage1/tcc" "$work/bootstrap/stage2/tcc"
printf 'airlock stage2-seeded bootstrap complete\n'
