#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
artifacts=$root/artifacts/airlock-rebuild-portable-packaged
rootfs=$artifacts/rootfs
work=$artifacts/work
compare_in=$artifacts/compare-in
compare_out=$artifacts/compare-out
initrd_gz=$root/../../slackware-10.2/iso/isolinux/initrd.img
portable_tar=$root/artifacts/airlock-bootstrap-portable/tcc-portable.tar
gzip_pkg=$root/artifacts/airlock-bootstrap-portable/work/repo/a/gzip-1.3.3-i386-2.tgz
patch_pkg=$root/artifacts/airlock-bootstrap-portable/work/repo/a/patch-2.5.4-i386-1.tgz
sed_pkg=$root/artifacts/airlock-bootstrap-portable/work/repo/a/sed-4.0.9-i386-2.tgz
tar_pkg=$root/artifacts/airlock-bootstrap-portable/work/repo/a/tar-1.13-i386-1.tgz
mawk_pkg=$root/artifacts/airlock-bootstrap-portable/work/repo/a/mawk-1.3.3-i386-1.tgz
tarball_bz2=$root/tcc-0.9.27.tar.bz2
musl_tarball=$root/musl-1.1.24.tar.gz
bootstrappable_h=$root/M2libc/bootstrappable.h
bootstrappable_c=$root/M2libc/bootstrappable.c
inner_script=$root/airlock/rebuild-portable-packaged.sh

if [ ! -f "$portable_tar" ]; then
  printf 'missing portable tarball; run test-airlock-bootstrap-portable.sh first\n' >&2
  exit 1
fi

if [ ! -f "$gzip_pkg" ] || [ ! -f "$patch_pkg" ] || [ ! -f "$sed_pkg" ] || [ ! -f "$tar_pkg" ] || [ ! -f "$mawk_pkg" ]; then
  printf 'missing packaged gzip/patch/sed/tar/mawk; run test-airlock-bootstrap-portable.sh first\n' >&2
  exit 1
fi

rm -rf "$artifacts"
mkdir -p "$rootfs" "$work" "$work/src/M2libc" "$work/airlock"

tmp_img=$artifacts/initrd.ext2
gzip -dc "$initrd_gz" > "$tmp_img"
debugfs -R "rdump / $rootfs" "$tmp_img" >/dev/null 2>"$artifacts/debugfs-rdump.err"
mkdir -p "$rootfs/work"

( cd "$rootfs" && /bin/tar -xzf "$gzip_pkg" )
( cd "$rootfs" && /bin/tar -xzf "$patch_pkg" )
( cd "$rootfs" && /bin/tar -xzf "$sed_pkg" )
( cd "$rootfs" && /bin/tar -xzf "$tar_pkg" )
( cd "$rootfs" && /bin/tar -xzf "$mawk_pkg" )

cp -f "$portable_tar" "$work/tcc-portable.tar"
cp -f "$root/unbz2.c" "$work/src/unbz2.c"
cp -f "$root/untar.c" "$work/src/untar.c"
cp -f "$bootstrappable_h" "$work/src/M2libc/bootstrappable.h"
cp -f "$bootstrappable_c" "$work/src/M2libc/bootstrappable.c"
cp -f "$tarball_bz2" "$work/tcc-0.9.27.tar.bz2"
cp -f "$musl_tarball" "$work/musl-1.1.24.tar.gz"
cp -f "$root/airlock/crt.c" "$work/crt.c"
cp -f "$root/airlock/glibc-compat.c" "$work/airlock/glibc-compat.c"
cp -f "$root/airlock/inside-airlock.sh.in" "$work/inside-airlock.sh"
cp -f "$inner_script" "$work/rebuild-portable-packaged.sh"
mkdir -p "$work/airlock/build-headers" "$work/airlock/portable-headers"
cp -f "$root/airlock/build-headers/stdarg.h.in" "$work/airlock/build-headers/stdarg.h"
cp -f "$root/airlock/build-headers/stdio.h.in" "$work/airlock/build-headers/stdio.h"
cp -f "$root/airlock/portable-headers/stdarg.h" "$work/airlock/portable-headers/stdarg.h"
cp -f "$root/airlock/portable-headers/stdio.h" "$work/airlock/portable-headers/stdio.h"
cp -f "$root/airlock/tcc-driver.sh.in" "$work/airlock/tcc-driver.sh.in"
cp -f "$root/airlock/tcc-glibc.sh.in" "$work/airlock/tcc-glibc.sh.in"
cp -f "$root/airlock/tcc-portable-driver.sh" "$work/airlock/tcc-portable-driver.sh"
cp -f "$root/airlock/tcc-portable-glibc.sh" "$work/airlock/tcc-portable-glibc.sh"

chmod 0755 "$work/inside-airlock.sh" "$work/rebuild-portable-packaged.sh"
bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/rebuild-portable-packaged.sh

test -x "$rootfs/bin/gzip"
test -x "$rootfs/usr/bin/mawk"
test -f "$work/tcc-portable-rebuilt.tar"
rm -rf "$compare_in" "$compare_out"
mkdir -p "$compare_in" "$compare_out"
tar -xf "$portable_tar" -C "$compare_in"
tar -xf "$work/tcc-portable-rebuilt.tar" -C "$compare_out"
diff -qr "$compare_in/tcc-portable" "$compare_out/tcc-portable" >/dev/null
printf 'airlock packaged tool rebuild harness complete\n'
