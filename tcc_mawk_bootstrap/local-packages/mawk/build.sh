#!/bin/sh
set -eu

root=${1:?usage: build.sh /work/bootstrap/tcc-portable}
tcc_glibc=$root/bin/tcc-glibc

pkgroot=/work/package-build/mawk
srcroot=/work/local-source/mawk
builddir=$pkgroot/build
pkgdir=$pkgroot/package-mawk
outdir=$pkgroot/out
version=1.3.3
name=mawk
srcdir=$builddir/$name-$version
pkgbase=$name-$version-tcc

rm -rf "$pkgroot"
mkdir -p "$builddir" "$pkgdir" "$outdir"

( cd "$builddir" && /bin/tar-1.13 -xzf "$srcroot/mawk_1.3.3.orig.tar.gz" )

cd "$srcdir"
chmod -R u+w .
cat > config.h <<'EOF'
/* generated for the tcc-portable airlock build */
#ifndef CONFIG_H
#define CONFIG_H

#define SIZE_T_STDDEF_H 1
#define HAVE_REAL_PIPES 1
#define HAVE_FAKE_PIPES 0
#define STDC_MATHERR 0
#define SW_FP_CHECK 0

#endif
EOF
mawk '
  /^#define zmalloc\(size\)/ { print "#define zmalloc(size) ((PTR)malloc((size)))"; next }
  /^#define zfree\(p,size\)/ { print "#define zfree(p,size) free((p))"; next }
  /^#define ZMALLOC\(type\)/ { print "#define ZMALLOC(type)  ((type*)malloc(sizeof(type)))"; next }
  /^#define ZFREE\(p\)/ { print "#define ZFREE(p)\tfree((p))"; next }
  { print }
' zmalloc.h > zmalloc.h.new
mv zmalloc.h.new zmalloc.h

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

mkdir -p "$pkgdir/usr/bin" "$pkgdir/usr/man/man1" "$pkgdir/usr/doc/$pkgbase"
cp -f mawk "$pkgdir/usr/bin/mawk"
chmod 0755 "$pkgdir/usr/bin/mawk"
cp -f man/mawk.1 "$pkgdir/usr/man/man1/mawk.1"
chmod 0644 "$pkgdir/usr/man/man1/mawk.1"
for doc in README INSTALL COPYING ACKNOWLEDGMENT CHANGES; do
  if [ -f "$doc" ]; then
    cp -f "$doc" "$pkgdir/usr/doc/$pkgbase/$doc"
    chmod 0644 "$pkgdir/usr/doc/$pkgbase/$doc"
  fi
done

pkgfile=$outdir/$pkgbase.tar.gz
( cd "$pkgdir" && /bin/tar-1.13 -cf - . ) | /bin/gzip.bin -9c > "$pkgfile"

printf 'built %s\n' "$pkgfile"
