#!/bin/sh
set -eu

root=${1:?usage: build.sh /work/bootstrap/tcc-portable}
tcc_glibc=$root/bin/tcc-glibc
tcc_raw=$root/bin/tcc
common_tccdir=$root/lib/tcc
wrap_include=$root/include
musl_include=$root/include/musl

pkgroot=/work/package-build/bash
srcroot=/work/slackware-source/a/bash
patchdir=/work/package-scripts/a/bash/patches
builddir=$pkgroot/build
pkgdir=$pkgroot/package-bash
repodir=/work/repo/a
version=3.0
arch=i386
build=3
name=bash
srcdir=$builddir/$name-$version

rm -rf "$pkgroot"
mkdir -p "$builddir" "$pkgdir" "$repodir"

( cd "$builddir" && /bin/tar-1.13 -xzf "$srcroot/bash-$version.tar.gz" )

cd "$srcdir"
chmod -R u+w .

for patch_file in "$srcroot"/patches/*; do
  case $patch_file in
    *.gz)
      /bin/gzip.bin -dc "$patch_file" | /usr/bin/patch -p0
      ;;
  esac
done

oldpwd=$(pwd)
cd "$patchdir"
set -- *.patch
[ -f "$1" ]
for patch_file do
  /usr/bin/patch -d "$oldpwd" -p1 < "$patchdir/$patch_file"
done
cd "$oldpwd"

mawk '
  BEGIN {
    debugger = "/usr/lib/bash/bashdb-main.inc"
  }
  {
    gsub(/@DEBUGGER_START_FILE@/, debugger)
    print
  }
' pathnames.h.in > pathnames.h

patchlevel=$(mawk '/^#define[ \t]+PATCHLEVEL/{print $3}' patchlevel.h)
dist_major=$(mawk 'BEGIN { print "3" }')
dist_minor=$(mawk 'BEGIN { print "00" }')
float_dist=$dist_major.$dist_minor
printf '1\n' > .build
printf '%s\n' \
  '/* Version control for the shell.  This file gets changed when you say' \
  "   \`make version.h' to the Makefile.  It is created by mkversion. */" \
  '' \
  '/* The distribution version number of this shell. */' \
  "#define DISTVERSION \"$float_dist\"" \
  '' \
  '/* The last built version of this shell. */' \
  '#define BUILDVERSION 1' \
  '' \
  '/* The release status of this shell. */' \
  '#define RELSTATUS "release"' \
  '' \
  '/* A version string for use by sccs and the what command. */' \
  "#define SCCSVERSION \"@(#)Bash version $float_dist.$patchlevel(1) release GNU\"" \
  > version.h

system_defs='-DPROGRAM="bash" -DCONF_HOSTTYPE="i386" -DCONF_OSTYPE="linux-gnu" -DCONF_MACHTYPE="i386-slackware-linux-gnu" -DCONF_VENDOR="unknown" -DLOCALEDIR="/usr/share/locale" -DPACKAGE="bash"'
common_includes='-I. -I./include -I./lib -I./builtins -I./lib/glob -I./lib/tilde -I./lib/sh'
common_cflags='-DHAVE_CONFIG_H -DSHELL'

compile_cmd() {
  "$tcc_raw" \
    -B"$common_tccdir" \
    -m32 \
    -nostdinc \
    -I"$wrap_include" \
    -isystem "$musl_include" \
    -isystem "$musl_include/bits" \
    $common_cflags \
    $system_defs \
    $common_includes \
    "$@"
}

link_cmd() {
  "$tcc_raw" \
    -B"$common_tccdir" \
    -m32 \
    -nostdinc \
    -I"$wrap_include" \
    -isystem "$musl_include" \
    -isystem "$musl_include/bits" \
    $common_cflags \
    $system_defs \
    $common_includes \
    -L/lib \
    -L/usr/lib \
    -L/lib32 \
    -L/usr/lib32 \
    -L/lib/i386-linux-gnu \
    -L/usr/lib/i386-linux-gnu \
    -nostdlib \
    "$@" \
    "$common_tccdir/crt.c" \
    "$common_tccdir/glibc-compat.o" \
    "$common_tccdir/libtcc1.o" \
    /lib/libc.so.6 \
    /lib/libm.so.6 \
    /lib/libdl.so.2
}

link_cmd support/mksignames.c -o mksignames
link_cmd mksyntax.c -o mksyntax
link_cmd builtins/mkbuiltins.c -o builtins/mkbuiltins
link_cmd -I. -I./builtins builtins/psize.c -o builtins/psize.aux

./mksignames lsignames.h
cp -f lsignames.h signames.h
./mksyntax -o syntax.c

builtin_defs='
alias.def bind.def break.def builtin.def cd.def colon.def command.def complete.def
caller.def declare.def echo.def enable.def eval.def exec.def exit.def fc.def
fg_bg.def hash.def help.def history.def jobs.def kill.def let.def read.def
return.def set.def setattr.def shift.def source.def suspend.def test.def
times.def trap.def type.def ulimit.def umask.def wait.def getopts.def
reserved.def pushd.def shopt.def printf.def
'

(
  cd builtins
  ./mkbuiltins -externfile builtext.h -structfile builtins.c -noproduction -D . $builtin_defs
  for def in $builtin_defs; do
    ./mkbuiltins -D . "$def"
  done
  /bin/sh ./psize.sh > pipesize.h
)

libsh_objs='
clktck clock getenv oslib setlinebuf itos zread zwrite shtty shmatch netconn
netopen timeval makepath pathcanon pathphys tmpfile stringlist stringvec spell
shquote strtrans strindex snprintf mailstat fmtulong fmtullong fmtumax xstrchr
zcatfd
'

for stem in $libsh_objs; do
  compile_cmd -c "lib/sh/$stem.c" -o "lib/sh/$stem.o"
done

glob_objs='glob strmatch smatch xmbsrtowcs'
for stem in $glob_objs; do
  compile_cmd -c "lib/glob/$stem.c" -o "lib/glob/$stem.o"
done

compile_cmd -c lib/tilde/tilde.c -o lib/tilde/tilde.o
compile_cmd -c lib/malloc/alloca.c -o lib/malloc/alloca.o

builtin_objs='
alias bind break builtin caller cd colon command declare echo enable eval exec
exit fc fg_bg hash help history jobs kill let pushd read return shopt printf
set setattr shift source suspend test times trap type ulimit umask wait getopts
builtins common evalstring evalfile getopt bashgetopt
'

for stem in $builtin_objs; do
  compile_cmd -c "builtins/$stem.c" -o "builtins/$stem.o"
done

top_objs='
shell eval y.tab general make_cmd print_cmd dispose_cmd execute_cmd variables
copy_cmd error expr flags nojobs subst hashcmd hashlib mailcheck trap input
unwind_prot pathexp sig test version alias array arrayfunc braces bracecomp
bashhist bashline list stringlib locale findcmd redir pcomplete pcomplib syntax
xmalloc
'

for stem in $top_objs; do
  compile_cmd -c "$stem.c" -o "$stem.o"
done

link_cmd \
  shell.o eval.o y.tab.o general.o make_cmd.o print_cmd.o dispose_cmd.o \
  execute_cmd.o variables.o copy_cmd.o error.o expr.o flags.o nojobs.o \
  subst.o hashcmd.o hashlib.o mailcheck.o trap.o input.o unwind_prot.o \
  pathexp.o sig.o test.o version.o alias.o array.o arrayfunc.o braces.o \
  bracecomp.o bashhist.o bashline.o list.o stringlib.o locale.o findcmd.o \
  redir.o pcomplete.o pcomplib.o syntax.o xmalloc.o \
  builtins/alias.o builtins/bind.o builtins/break.o builtins/builtin.o \
  builtins/caller.o builtins/cd.o builtins/colon.o builtins/command.o \
  builtins/declare.o builtins/echo.o builtins/enable.o builtins/eval.o \
  builtins/exec.o builtins/exit.o builtins/fc.o builtins/fg_bg.o \
  builtins/hash.o builtins/help.o builtins/history.o builtins/jobs.o \
  builtins/kill.o builtins/let.o builtins/pushd.o builtins/read.o \
  builtins/return.o builtins/shopt.o builtins/printf.o builtins/set.o \
  builtins/setattr.o builtins/shift.o builtins/source.o builtins/suspend.o \
  builtins/test.o builtins/times.o builtins/trap.o builtins/type.o \
  builtins/ulimit.o builtins/umask.o builtins/wait.o builtins/getopts.o \
  builtins/builtins.o builtins/common.o builtins/evalstring.o \
  builtins/evalfile.o builtins/getopt.o builtins/bashgetopt.o \
  lib/sh/clktck.o lib/sh/clock.o lib/sh/getenv.o lib/sh/oslib.o \
  lib/sh/setlinebuf.o lib/sh/itos.o lib/sh/zread.o lib/sh/zwrite.o \
  lib/sh/shtty.o lib/sh/shmatch.o lib/sh/netconn.o lib/sh/netopen.o \
  lib/sh/timeval.o lib/sh/makepath.o lib/sh/pathcanon.o lib/sh/pathphys.o \
  lib/sh/tmpfile.o lib/sh/stringlist.o lib/sh/stringvec.o lib/sh/spell.o \
  lib/sh/shquote.o lib/sh/strtrans.o lib/sh/strindex.o lib/sh/snprintf.o \
  lib/sh/mailstat.o lib/sh/fmtulong.o lib/sh/fmtullong.o lib/sh/fmtumax.o \
  lib/sh/xstrchr.o lib/sh/zcatfd.o \
  lib/glob/glob.o lib/glob/strmatch.o lib/glob/smatch.o lib/glob/xmbsrtowcs.o \
  lib/tilde/tilde.o lib/malloc/alloca.o \
  -o bash

test "$(./bash -c 'echo packaged bash ok')" = 'packaged bash ok'

mkdir -p \
  "$pkgdir/bin" \
  "$pkgdir/usr/man/man1" \
  "$pkgdir/usr/doc/$name-$version" \
  "$pkgdir/install"

cp -f bash "$pkgdir/bin/bash2.new"
chmod 0755 "$pkgdir/bin/bash2.new"

for page in doc/bash.1 doc/builtins.1 doc/rbash.1; do
  if [ -f "$page" ]; then
    base=$(basename "$page")
    /bin/gzip.bin -9c "$page" > "$pkgdir/usr/man/man1/$base.gz"
    chmod 0644 "$pkgdir/usr/man/man1/$base.gz"
  fi
done

for doc in AUTHORS CHANGES COMPAT COPYING INSTALL MANIFEST NEWS NOTES README Y2K doc/FAQ doc/INTRO; do
  if [ -f "$doc" ]; then
    base=$(basename "$doc")
    cp -f "$doc" "$pkgdir/usr/doc/$name-$version/$base"
    chmod 0644 "$pkgdir/usr/doc/$name-$version/$base"
  fi
done

/bin/gzip.bin -dc "$srcroot/doinst.sh.gz" > "$pkgdir/install/doinst.sh"
chmod 0755 "$pkgdir/install/doinst.sh"
cp -f /work/package-scripts/a/bash/slack-desc "$pkgdir/install/slack-desc"
chmod 0644 "$pkgdir/install/slack-desc"

pkgfile=$repodir/$name-$version-$arch-$build.tgz
( cd "$pkgdir" && /bin/tar-1.13 -cf - . ) | /bin/gzip.bin -9c > "$pkgfile"

printf 'built %s\n' "$pkgfile"
