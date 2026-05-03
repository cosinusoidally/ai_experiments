#!/bin/sh
set -eu

root=${1:?usage: build.sh /work/bootstrap/tcc-portable}
tcc_glibc=$root/bin/tcc-glibc

pkgroot=/work/package-build/sed
srcroot=/work/slackware-source/a/sed
patchdir=/work/package-scripts/a/sed/patches
builddir=$pkgroot/build
pkgdir=$pkgroot/package-sed
repodir=/work/repo/a
version=4.0.9
arch=i386
build=2
name=sed
srcdir=$builddir/$name-$version

rm -rf "$pkgroot"
mkdir -p "$builddir" "$pkgdir" "$repodir"

( cd "$builddir" && /bin/tar-1.13 -xzf "$srcroot/sed-$version.tar.gz" )

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

cp -f lib/regex_.h lib/regex.h

objs='
lib/alloca.o
lib/getopt.o
lib/getopt1.o
lib/utils.o
lib/regex.o
lib/obstack.o
sed/sed.o
sed/compile.o
sed/execute.o
sed/regexp.o
sed/fmt.o
'

cflags='-DHAVE_CONFIG_H -DLOCALEDIR="/usr/share/locale" -I. -Ilib -Ised'

for src in \
  lib/alloca.c \
  lib/getopt.c \
  lib/getopt1.c \
  lib/utils.c \
  lib/regex.c \
  lib/obstack.c \
  sed/sed.c \
  sed/compile.c \
  sed/execute.c \
  sed/regexp.c \
  sed/fmt.c
do
  "$tcc_glibc" $cflags -c "$src" -o "${src%.c}.o"
done

"$tcc_glibc" $objs -o sed/sed

test "$(printf 'a\n' | ./sed/sed 's/a/b/')" = 'b'

mkdir -p \
  "$pkgdir/bin" \
  "$pkgdir/usr/bin" \
  "$pkgdir/usr/man/man1" \
  "$pkgdir/usr/info" \
  "$pkgdir/usr/doc/$name-$version" \
  "$pkgdir/install"

cp -f sed/sed "$pkgdir/bin/sed"
chmod 0755 "$pkgdir/bin/sed"
ln -sf /bin/sed "$pkgdir/usr/bin/sed"
/bin/gzip.bin -9c doc/sed.1 > "$pkgdir/usr/man/man1/sed.1.gz"
chmod 0644 "$pkgdir/usr/man/man1/sed.1.gz"

for info in doc/sed.info doc/sed.info-1 doc/sed.info-2; do
  if [ -f "$info" ]; then
    base=$(basename "$info")
    /bin/gzip.bin -9c "$info" > "$pkgdir/usr/info/$base.gz"
    chmod 0644 "$pkgdir/usr/info/$base.gz"
  fi
done

for doc in ANNOUNCE AUTHORS BUGS COPYING COPYING.DOC INSTALL NEWS README README.boot THANKS TODO; do
  if [ -f "$doc" ]; then
    cp -f "$doc" "$pkgdir/usr/doc/$name-$version/$doc"
    chmod 0644 "$pkgdir/usr/doc/$name-$version/$doc"
  fi
done

cp -f /work/package-scripts/a/sed/slack-desc "$pkgdir/install/slack-desc"
chmod 0644 "$pkgdir/install/slack-desc"

pkgfile=$repodir/$name-$version-$arch-$build.tgz
( cd "$pkgdir" && /bin/tar-1.13 -cf - . ) | /bin/gzip.bin -9c > "$pkgfile"

printf 'built %s\n' "$pkgfile"
