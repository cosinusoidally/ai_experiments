#!/bin/sh
set -eu

root=${1:?usage: build.sh /work/bootstrap/tcc-portable}
tcc_glibc=$root/bin/tcc-glibc

pkgroot=/work/package-build/gzip
srcroot=/work/slackware-source/a/gzip
patchdir=/work/package-scripts/a/gzip/patches
builddir=$pkgroot/build
pkgdir=$pkgroot/package-gzip
outdir=$pkgroot/out
version=1.3.3
arch=i386
build=2
name=gzip
srcdir=$builddir/$name-$version

rm -rf "$pkgroot"
mkdir -p "$builddir" "$pkgdir" "$outdir"

( cd "$pkgdir" && /bin/tar-1.13 -xzf "$srcroot/_gzip.tar.gz" )
( cd "$builddir" && /bin/tar-1.13 -xzf "$srcroot/gzip-$version.tar.gz" )

cd "$srcdir"
chmod -R u+w .
oldpwd=$(pwd)
cd "$patchdir"
set -- *.patch
[ -f "$1" ]
for patch do
  /usr/bin/patch -d "$oldpwd" -p1 < "$patchdir/$patch"
done
cd "$oldpwd"

for script in gzexe zdiff zforce zgrep zless zmore znew; do
  sed -e 1d -e "s|BINDIR|/bin|g" "$script.in" > "$script"
  chmod 0755 "$script"
done

for src in bits crypt deflate getopt getopt1 gzip inflate lzw trees unlzh unlzw unpack unzip util yesno zip; do
  "$tcc_glibc" -DHAVE_CONFIG_H -I. -c "$src.c" -o "$src.o"
done

"$tcc_glibc" \
  bits.o crypt.o deflate.o getopt.o getopt1.o gzip.o inflate.o lzw.o trees.o \
  unlzh.o unlzw.o unpack.o unzip.o util.o yesno.o zip.o \
  -o gzip

cat gzip > "$pkgdir/bin/gzip"
cat gzexe > "$pkgdir/usr/bin/gzexe"
cat zdiff > "$pkgdir/usr/bin/zdiff"
cat zforce > "$pkgdir/usr/bin/zforce"
cat zgrep > "$pkgdir/usr/bin/zgrep"
cat zless > "$pkgdir/usr/bin/zless"
cat zmore > "$pkgdir/usr/bin/zmore"
cat znew > "$pkgdir/usr/bin/znew"

for page in gunzip.1 gzexe.1 gzip.1 zcat.1 zcmp.1 zdiff.1 zforce.1 zgrep.1 zless.1 zmore.1 znew.1; do
  ./gzip -9c "$page" > "$pkgdir/usr/man/man1/$page.gz"
done

mkdir -p "$pkgdir/usr/info"
./gzip -9c gzip.info > "$pkgdir/usr/info/gzip.info.gz"

mkdir -p "$pkgdir/usr/doc/gzip-$version"
cp -a README AUTHORS COPYING INSTALL NEWS README-alpha THANKS TODO \
  "$pkgdir/usr/doc/gzip-$version"
for doc in "$pkgdir"/usr/doc/gzip-"$version"/*; do
  if [ -f "$doc" ]; then
    chmod 0644 "$doc"
  fi
done
cat "$srcroot/slack-desc" > "$pkgdir/install/slack-desc"

pkgfile=$outdir/$name-$version-$arch-$build.tgz
( cd "$pkgdir" && /bin/tar-1.13 -cf - . ) | /bin/gzip.bin -9c > "$pkgfile"

printf 'built %s\n' "$pkgfile"
