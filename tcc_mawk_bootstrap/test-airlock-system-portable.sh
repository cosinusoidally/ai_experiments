#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
artifacts=$root/artifacts/airlock-system-portable
rootfs=$artifacts/rootfs
work=$artifacts/work
initrd_gz=$root/../../slackware-10.2/iso/isolinux/initrd.img
portable_tar=$root/artifacts/airlock-bootstrap-portable/tcc-portable.tar
gzip_pkg=$root/artifacts/airlock-bootstrap-portable/work/repo/a/gzip-1.3.3-i386-2.tgz
test_script=$root/airlock/test-system.sh

if [ ! -f "$portable_tar" ]; then
  printf 'missing portable tarball; run test-airlock-bootstrap-portable.sh first\n' >&2
  exit 1
fi

if [ ! -f "$gzip_pkg" ]; then
  printf 'missing gzip package; run test-airlock-bootstrap-portable.sh first\n' >&2
  exit 1
fi

rm -rf "$artifacts"
mkdir -p "$rootfs" "$work"

tmp_img=$artifacts/initrd.ext2
gzip -dc "$initrd_gz" > "$tmp_img"
debugfs -R "rdump / $rootfs" "$tmp_img" >/dev/null 2>"$artifacts/debugfs-rdump.err"
mkdir -p "$rootfs/work"

cp -f "$portable_tar" "$work/tcc-portable.tar"
cp -f "$gzip_pkg" "$work/gzip-1.3.3-i386-2.tgz"
cp -f "$test_script" "$work/test-system.sh"
chmod 0755 "$work/test-system.sh"

bwrap \
  --bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh /work/test-system.sh

test -x "$rootfs/bin/gzip"
test -x "$rootfs/opt/tcc-portable/bin/tcc-glibc"
printf 'airlock portable system harness complete\n'
