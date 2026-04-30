#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
artifacts=$root/artifacts/airlock-tarball
rootfs=$artifacts/rootfs
work=$artifacts/work
host_ref=$artifacts/host-ref
initrd_gz=$root/../../slackware-10.2/iso/isolinux/initrd.img
slack_bin_pkg=$root/../../slackware-10.2/iso/slackware/a/bin-10.2-i486-1.tgz
woody_mawk=/home/foo/src/woody_mawk/mawk
tarball_bz2=$root/tcc-0.9.27.tar.bz2

rm -rf "$artifacts"
mkdir -p "$rootfs" "$work" "$host_ref"

tmp_img=$artifacts/initrd.ext2
gzip -dc "$initrd_gz" > "$tmp_img"
debugfs -R "rdump / $rootfs" "$tmp_img" >/dev/null 2>"$artifacts/debugfs-rdump.err"
mkdir -p "$rootfs/work"

mkdir -p "$rootfs/usr/bin"
tar -xzf "$slack_bin_pkg" -C "$artifacts" usr/bin/uuencode
cp -f "$artifacts/usr/bin/uuencode" "$rootfs/usr/bin/uuencode"
cp -f "$woody_mawk" "$rootfs/usr/bin/mawk"
chmod 0755 "$rootfs/usr/bin/uuencode" "$rootfs/usr/bin/mawk"
rm -rf "$artifacts/usr"

cp -f "$root/extract-bz2.awk" "$work/extract-bz2.awk"
cp -f "$root/extract-tar.awk" "$work/extract-tar.awk"
cp -f "$root/extract-tarball.awk" "$work/extract-tarball.awk"
cp -f "$tarball_bz2" "$work/tcc-0.9.27.tar.bz2"

tar -xjf "$tarball_bz2" -C "$host_ref"

bwrap \
  --ro-bind "$rootfs" / \
  --bind "$work" /work \
  --dev /dev \
  --proc /proc \
  --tmpfs /tmp \
  --chdir /work \
  /bin/sh -c 'BOOTSTRAP_ROOT=/work B64ENCODER=uuencode /usr/bin/mawk -f /work/extract-tarball.awk /work/tcc-0.9.27.tar.bz2 /work/out'

diff -qr "$host_ref" "$work/out"
printf 'airlock extract-tarball.awk matches tar for %s\n' "$tarball_bz2"
