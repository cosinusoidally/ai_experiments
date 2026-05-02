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
mkdir -p "$rootfs" "$work" "$work/seed-headers/sys" "$work/src/M2libc" "$work/airlock"

tmp_img=$artifacts/initrd.ext2
gzip -dc "$initrd_gz" > "$tmp_img"
debugfs -R "rdump / $rootfs" "$tmp_img" >/dev/null 2>"$artifacts/debugfs-rdump.err"
mkdir -p "$rootfs/work"

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
mkdir -p "$work/airlock/build-headers"
cp -f "$root/airlock/build-headers/stdarg.h.in" "$work/airlock/build-headers/stdarg.h"
cp -f "$root/airlock/build-headers/stdio.h.in" "$work/airlock/build-headers/stdio.h"
cp -f "$root/airlock/tcc-driver.sh.in" "$work/airlock/tcc-driver.sh.in"
cp -f "$root/airlock/tcc-glibc.sh.in" "$work/airlock/tcc-glibc.sh.in"

chmod 0755 "$work/inside-airlock.sh"
HOST_ARTIFACT_ROOT="$work/bootstrap" bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/inside-airlock.sh

cmp -s "$work/bootstrap/stage1/tcc" "$work/bootstrap/stage2/tcc"
printf 'airlock stage2-seeded bootstrap complete\n'
