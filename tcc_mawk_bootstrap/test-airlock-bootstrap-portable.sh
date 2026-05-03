#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
artifacts=$root/artifacts/airlock-bootstrap-portable
rootfs=$artifacts/rootfs
work=$artifacts/work
initrd_gz=$root/../../slackware-10.2/iso/isolinux/initrd.img
portable_tar=$root/artifacts/airlock-bootstrap-stage2/tcc-portable.tar
out_tar=$artifacts/tcc-portable.tar
tarball_bz2=$root/tcc-0.9.27.tar.bz2
musl_tarball=$root/musl-1.1.24.tar.gz
bootstrappable_h=$root/M2libc/bootstrappable.h
bootstrappable_c=$root/M2libc/bootstrappable.c
woody_mawk=/home/foo/src/woody_mawk/mawk
bin_pkg=$root/../../slackware-10.2/iso/slackware/a/bin-10.2-i486-1.tgz

if [ ! -f "$portable_tar" ]; then
  printf 'missing portable tarball; run test-airlock-bootstrap-stage2.sh first\n' >&2
  exit 1
fi

rm -rf "$artifacts"
mkdir -p "$rootfs" "$work" "$work/src/M2libc" "$work/airlock" \
  "$work/slackware-source/a/gzip" "$work/package-scripts/a/gzip" \
  "$work/slackware-source/a/patch" "$work/package-scripts/a/patch" \
  "$work/slackware-source/a/sed" "$work/package-scripts/a/sed" \
  "$work/slackware-source/a/tar" "$work/package-scripts/a/tar" \
  "$work/slackware-source/a/bash" "$work/package-scripts/a/bash" \
  "$work/local-source/mawk" "$work/package-scripts/a/mawk" \
  "$work/repo/a"

tmp_img=$artifacts/initrd.ext2
gzip -dc "$initrd_gz" > "$tmp_img"
debugfs -R "rdump / $rootfs" "$tmp_img" >/dev/null 2>"$artifacts/debugfs-rdump.err"
mkdir -p "$rootfs/work"

cp -f "$portable_tar" "$work/tcc-portable.tar"
cp -f "$root/unbz2.c" "$work/src/unbz2.c"
cp -f "$root/untar.c" "$work/src/untar.c"
cp -f "$bootstrappable_h" "$work/src/M2libc/bootstrappable.h"
cp -f "$bootstrappable_c" "$work/src/M2libc/bootstrappable.c"
cp -f "$tarball_bz2" "$work/tcc-0.9.27.tar.bz2"
cp -f "$musl_tarball" "$work/musl-1.1.24.tar.gz"
mkdir -p "$rootfs/usr/bin"
cp -f "$woody_mawk" "$rootfs/usr/bin/mawk"
chmod 0755 "$rootfs/usr/bin/mawk"
tar -xOf "$bin_pkg" usr/bin/patch > "$rootfs/usr/bin/patch"
chmod 0755 "$rootfs/usr/bin/patch"
cp -f "$root/airlock/crt.c" "$work/crt.c"
cp -f "$root/airlock/glibc-compat.c" "$work/airlock/glibc-compat.c"
cp -f "$root/airlock/inside-airlock.sh.in" "$work/inside-airlock.sh"
mkdir -p "$work/airlock/build-headers" "$work/airlock/portable-headers"
cp -f "$root/airlock/build-headers/stdarg.h.in" "$work/airlock/build-headers/stdarg.h"
cp -f "$root/airlock/build-headers/stdio.h.in" "$work/airlock/build-headers/stdio.h"
cp -f "$root/airlock/portable-headers/stdarg.h" "$work/airlock/portable-headers/stdarg.h"
cp -f "$root/airlock/portable-headers/stdio.h" "$work/airlock/portable-headers/stdio.h"
cp -f "$root/airlock/tcc-driver.sh.in" "$work/airlock/tcc-driver.sh.in"
cp -f "$root/airlock/tcc-glibc.sh.in" "$work/airlock/tcc-glibc.sh.in"
cp -f "$root/airlock/tcc-portable-driver.sh" "$work/airlock/tcc-portable-driver.sh"
cp -f "$root/airlock/tcc-portable-glibc.sh" "$work/airlock/tcc-portable-glibc.sh"
cp -f "$root/slackware-packages/a/gzip/build.sh" "$work/package-scripts/a/gzip/build.sh"
mkdir -p "$work/package-scripts/a/gzip/patches"
cp -Rf "$root/slackware-packages/a/gzip/patches/." "$work/package-scripts/a/gzip/patches/"
cp -f "$root/slackware-packages/a/patch/build.sh" "$work/package-scripts/a/patch/build.sh"
cp -f "$root/slackware-packages/a/patch/slack-desc" "$work/package-scripts/a/patch/slack-desc"
mkdir -p "$work/package-scripts/a/patch/patches"
cp -Rf "$root/slackware-packages/a/patch/patches/." "$work/package-scripts/a/patch/patches/"
cp -f "$root/slackware-packages/a/sed/build.sh" "$work/package-scripts/a/sed/build.sh"
cp -f "$root/slackware-packages/a/sed/slack-desc" "$work/package-scripts/a/sed/slack-desc"
mkdir -p "$work/package-scripts/a/sed/patches"
cp -Rf "$root/slackware-packages/a/sed/patches/." "$work/package-scripts/a/sed/patches/"
cp -f "$root/slackware-packages/a/tar/build.sh" "$work/package-scripts/a/tar/build.sh"
cp -f "$root/slackware-packages/a/tar/slack-desc" "$work/package-scripts/a/tar/slack-desc"
mkdir -p "$work/package-scripts/a/tar/patches"
cp -Rf "$root/slackware-packages/a/tar/patches/." "$work/package-scripts/a/tar/patches/"
cp -f "$root/slackware-packages/a/bash/build.sh" "$work/package-scripts/a/bash/build.sh"
cp -f "$root/slackware-packages/a/bash/slack-desc" "$work/package-scripts/a/bash/slack-desc"
mkdir -p "$work/package-scripts/a/bash/patches"
cp -Rf "$root/slackware-packages/a/bash/patches/." "$work/package-scripts/a/bash/patches/"
cp -f "$root/slackware-packages/a/mawk/build.sh" "$work/package-scripts/a/mawk/build.sh"
cp -f "$root/slackware-packages/a/mawk/slack-desc" "$work/package-scripts/a/mawk/slack-desc"
mkdir -p "$work/package-scripts/a/mawk/patches"
cp -Rf "$root/slackware-packages/a/mawk/patches/." "$work/package-scripts/a/mawk/patches/"
cp -f "$root/mawk_1.3.3.orig.tar.gz" "$work/local-source/mawk/mawk_1.3.3.orig.tar.gz"
cp -f "$root/../../slackware-10.2/iso3/source/a/gzip/gzip-1.3.3.tar.gz" \
  "$work/slackware-source/a/gzip/gzip-1.3.3.tar.gz"
cp -f "$root/../../slackware-10.2/iso3/source/a/gzip/_gzip.tar.gz" \
  "$work/slackware-source/a/gzip/_gzip.tar.gz"
cp -f "$root/../../slackware-10.2/iso3/source/a/gzip/slack-desc" \
  "$work/slackware-source/a/gzip/slack-desc"
cp -f "$root/../../slackware-10.2/iso3/source/a/bin/patch-2.5.4.tar.gz" \
  "$work/slackware-source/a/patch/patch-2.5.4.tar.gz"
cp -f "$root/../../slackware-10.2/iso3/source/a/sed/sed-4.0.9.tar.gz" \
  "$work/slackware-source/a/sed/sed-4.0.9.tar.gz"
cp -f "$root/../../slackware-10.2/iso3/source/a/tar/tar-1.13.tar.gz" \
  "$work/slackware-source/a/tar/tar-1.13.tar.gz"
cp -f "$root/../../slackware-10.2/iso3/source/a/tar/tar.1.gz" \
  "$work/slackware-source/a/tar/tar.1.gz"
cp -f "$root/../../slackware-10.2/iso3/source/a/bash/bash-3.0.tar.gz" \
  "$work/slackware-source/a/bash/bash-3.0.tar.gz"
cp -f "$root/../../slackware-10.2/iso3/source/a/bash/doinst.sh.gz" \
  "$work/slackware-source/a/bash/doinst.sh.gz"
mkdir -p "$work/slackware-source/a/bash/patches"
cp -Rf "$root/../../slackware-10.2/iso3/source/a/bash/patches/." \
  "$work/slackware-source/a/bash/patches/"

chmod 0755 "$work/inside-airlock.sh"
bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/inside-airlock.sh

cmp -s "$work/bootstrap/stage1/tcc" "$work/bootstrap/stage2/tcc"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  -cf "$out_tar" -C "$work/bootstrap" tcc-portable
bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/package-scripts/a/gzip/build.sh /work/bootstrap/tcc-portable
bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/package-scripts/a/patch/build.sh /work/bootstrap/tcc-portable
bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/package-scripts/a/sed/build.sh /work/bootstrap/tcc-portable
bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/package-scripts/a/tar/build.sh /work/bootstrap/tcc-portable
bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/package-scripts/a/bash/build.sh /work/bootstrap/tcc-portable
bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/package-scripts/a/mawk/build.sh /work/bootstrap/tcc-portable
printf 'airlock portable bootstrap complete\n'
