#!/bin/sh
set -eu

root=${1:?usage: build.sh /work/bootstrap/tcc-portable}
tcc_glibc=$root/bin/tcc-glibc

pkgroot=/work/package-build/patch
srcroot=/work/slackware-source/a/patch
patchdir=/work/package-scripts/a/patch/patches
builddir=$pkgroot/build
pkgdir=$pkgroot/package-patch
repodir=/work/repo/a
version=2.5.4
arch=i386
build=1
name=patch
srcdir=$builddir/$name-$version
ed_define='-Ded_PROGRAM="/bin/ed"'

rm -rf "$pkgroot"
mkdir -p "$builddir" "$pkgdir" "$repodir"

( cd "$builddir" && /bin/tar-1.13 -xzf "$srcroot/patch-$version.tar.gz" )

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

printf '#define PATCH_VERSION "%s"\n' "$version" > patchlevel.h

objs='
addext argmatch backupfile basename error getopt getopt1 inp maketime mkdir
partime patch pch quotearg quotesys rmdir util version xmalloc
'

for stem in $objs; do
  "$tcc_glibc" -DHAVE_CONFIG_H "$ed_define" -I. -c "$stem.c" -o "$stem.o"
done

"$tcc_glibc" \
  addext.o argmatch.o backupfile.o basename.o error.o getopt.o getopt1.o \
  inp.o maketime.o mkdir.o partime.o patch.o pch.o quotearg.o quotesys.o \
  rmdir.o util.o version.o xmalloc.o \
  -o patch

printf 'old\n' > smoke.txt
printf '%s\n' '--- smoke.txt' '+++ smoke.txt' '@@ -1 +1 @@' '-old' '+new' \
  > smoke.patch
./patch -s < smoke.patch
test "$(cat smoke.txt)" = "new"
rm -f smoke.txt smoke.patch

mkdir -p \
  "$pkgdir/usr/bin" \
  "$pkgdir/usr/man/man1" \
  "$pkgdir/usr/doc/$name-$version" \
  "$pkgdir/install"

cp -f patch "$pkgdir/usr/bin/patch"
chmod 0755 "$pkgdir/usr/bin/patch"
/bin/gzip.bin -9c patch.man > "$pkgdir/usr/man/man1/patch.1.gz"
chmod 0644 "$pkgdir/usr/man/man1/patch.1.gz"
for doc in AUTHORS COPYING INSTALL NEWS README; do
  if [ -f "$doc" ]; then
    cp -f "$doc" "$pkgdir/usr/doc/$name-$version/$doc"
    chmod 0644 "$pkgdir/usr/doc/$name-$version/$doc"
  fi
done
cp -f /work/package-scripts/a/patch/slack-desc "$pkgdir/install/slack-desc"
chmod 0644 "$pkgdir/install/slack-desc"

pkgfile=$repodir/$name-$version-$arch-$build.tgz
( cd "$pkgdir" && /bin/tar-1.13 -cf - . ) | /bin/gzip.bin -9c > "$pkgfile"

printf 'built %s\n' "$pkgfile"
