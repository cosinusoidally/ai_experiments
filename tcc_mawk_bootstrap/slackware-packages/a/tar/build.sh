#!/bin/sh
set -eu

root=${1:?usage: build.sh /work/bootstrap/tcc-portable}
tcc_glibc=$root/bin/tcc-glibc

pkgroot=/work/package-build/tar
srcroot=/work/slackware-source/a/tar
patchdir=/work/package-scripts/a/tar/patches
builddir=$pkgroot/build
pkgdir=$pkgroot/package-tar
repodir=/work/repo/a
version=1.13
arch=i386
build=1
name=tar
srcdir=$builddir/$name-$version

rm -rf "$pkgroot"
mkdir -p "$builddir" "$pkgdir" "$repodir"

( cd "$builddir" && /bin/tar-1.13 -xzf "$srcroot/tar-$version.tar.gz" )

cd "$srcdir"
chmod -R u+w .
oldpwd=$(pwd)
cd "$patchdir"
set -- *.patch
[ -f "$1" ]
for patch_file do
  /usr/bin/patch -d "$oldpwd" -p1 < "$patchdir/$patch_file"
done
cd "$oldpwd"

lib_objs='
addext argmatch backupfile basename error exclude full-write getdate getopt
getopt1 modechange msleep quotearg safe-read xgetcwd xmalloc xstrdup xstrtol
xstrtoul xstrtoumax
'

src_objs='
arith buffer compare create delete extract incremen list mangle misc names
open3 rtapelib tar update
'

lib_cflags='-DHAVE_CONFIG_H -I. -Ilib -Isrc -I.'
locale_define='-DLOCALEDIR="/usr/share/locale"'
package_define='-DPACKAGE="tar"'
version_define='-DVERSION="1.13"'

for stem in $lib_objs; do
  "$tcc_glibc" $lib_cflags -c "lib/$stem.c" -o "lib/$stem.o"
done

for stem in $src_objs; do
  "$tcc_glibc" -DHAVE_CONFIG_H "$locale_define" "$package_define" "$version_define" -I. -Ilib -Isrc -c "src/$stem.c" -o "src/$stem.o"
done

"$tcc_glibc" \
  src/arith.o src/buffer.o src/compare.o src/create.o src/delete.o \
  src/extract.o src/incremen.o src/list.o src/mangle.o src/misc.o \
  src/names.o src/open3.o src/rtapelib.o src/tar.o src/update.o \
  lib/addext.o lib/argmatch.o lib/backupfile.o lib/basename.o lib/error.o \
  lib/exclude.o lib/full-write.o lib/getdate.o lib/getopt.o lib/getopt1.o \
  lib/modechange.o lib/msleep.o lib/quotearg.o lib/safe-read.o \
  lib/xgetcwd.o lib/xmalloc.o lib/xstrdup.o lib/xstrtol.o lib/xstrtoul.o \
  lib/xstrtoumax.o \
  -o tar

mkdir -p \
  "$pkgdir/bin" \
  "$pkgdir/usr/bin" \
  "$pkgdir/usr/man/man1" \
  "$pkgdir/usr/doc/$name-$version" \
  "$pkgdir/install"

cp -f tar "$pkgdir/bin/tar"
cp -f tar "$pkgdir/bin/tar-1.13"
chmod 0755 "$pkgdir/bin/tar" "$pkgdir/bin/tar-1.13"
ln -sf /bin/tar "$pkgdir/usr/bin/tar"
cp -f "$srcroot/tar.1.gz" "$pkgdir/usr/man/man1/tar.1.gz"
chmod 0644 "$pkgdir/usr/man/man1/tar.1.gz"
for doc in AUTHORS COPYING INSTALL NEWS README PORTS ABOUT-NLS THANKS TODO; do
  if [ -f "$doc" ]; then
    cp -f "$doc" "$pkgdir/usr/doc/$name-$version/$doc"
    chmod 0644 "$pkgdir/usr/doc/$name-$version/$doc"
  fi
done
cp -f /work/package-scripts/a/tar/slack-desc "$pkgdir/install/slack-desc"
chmod 0644 "$pkgdir/install/slack-desc"

pkgfile=$repodir/$name-$version-$arch-$build.tgz
( cd "$pkgdir" && /bin/tar-1.13 -cf - . ) | /bin/gzip.bin -9c > "$pkgfile"

printf 'built %s\n' "$pkgfile"
