#!/bin/sh
set -eu

root=${1:?usage: build.sh /work/bootstrap/tcc-portable}
tcc_glibc=$root/bin/tcc-glibc

pkgroot=/work/package-build/mawk
srcroot=/work/local-source/mawk
patchdir=/work/package-scripts/a/mawk/patches
builddir=$pkgroot/build
pkgdir=$pkgroot/package-mawk
repodir=/work/repo/a
version=1.3.3
arch=i386
build=1
name=mawk
srcdir=$builddir/$name-$version

rm -rf "$pkgroot"
mkdir -p "$builddir" "$pkgdir" "$repodir"

( cd "$builddir" && /bin/tar-1.13 -xzf "$srcroot/mawk_1.3.3.orig.tar.gz" )

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

objs='
parse scan memory main hash execute code da error init bi_vars cast print
bi_funct kw jmp array field split re_cmpl zmalloc fin files scancode matherr
fcall version missing
'
rexp_objs='rexp rexp0 rexp1 rexp2 rexp3'

for stem in $objs; do
  "$tcc_glibc" -DHAVE_CONFIG_H -I. -Irexp -c "$stem.c" -o "$stem.o"
done

for stem in $rexp_objs; do
  "$tcc_glibc" -DMAWK -I. -Irexp -c "rexp/$stem.c" -o "rexp/$stem.o"
done

"$tcc_glibc" \
  parse.o scan.o memory.o main.o hash.o execute.o code.o da.o error.o init.o \
  bi_vars.o cast.o print.o bi_funct.o kw.o jmp.o array.o field.o split.o \
  re_cmpl.o zmalloc.o fin.o files.o scancode.o matherr.o fcall.o version.o \
  missing.o rexp/rexp.o rexp/rexp0.o rexp/rexp1.o rexp/rexp2.o rexp/rexp3.o \
  -o mawk

printf 'BEGIN { print "mawk ok" }\n' > "$pkgroot/smoke.awk"
./mawk -f "$pkgroot/smoke.awk" /dev/null > "$pkgroot/smoke.out"
test "$(cat "$pkgroot/smoke.out")" = "mawk ok"

mkdir -p \
  "$pkgdir/usr/bin" \
  "$pkgdir/usr/man/man1" \
  "$pkgdir/usr/doc/$name-$version" \
  "$pkgdir/install"

cp -f mawk "$pkgdir/usr/bin/mawk"
chmod 0755 "$pkgdir/usr/bin/mawk"
cp -f man/mawk.1 "$pkgdir/usr/man/man1/mawk.1"
chmod 0644 "$pkgdir/usr/man/man1/mawk.1"
for doc in README INSTALL COPYING ACKNOWLEDGMENT CHANGES; do
  if [ -f "$doc" ]; then
    cp -f "$doc" "$pkgdir/usr/doc/$name-$version/$doc"
    chmod 0644 "$pkgdir/usr/doc/$name-$version/$doc"
  fi
done
cp -f /work/package-scripts/a/mawk/slack-desc "$pkgdir/install/slack-desc"
chmod 0644 "$pkgdir/install/slack-desc"

pkgfile=$repodir/$name-$version-$arch-$build.tgz
( cd "$pkgdir" && /bin/tar-1.13 -cf - . ) | /bin/gzip.bin -9c > "$pkgfile"

printf 'built %s\n' "$pkgfile"
