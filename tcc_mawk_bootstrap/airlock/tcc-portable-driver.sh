#!/bin/sh
set -eu

case $0 in
  */*) self_dir=${0%/*} ;;
  *) self_dir=. ;;
esac
self_dir=$(CDPATH= cd -- "$self_dir" && pwd)
root=$(CDPATH= cd -- "$self_dir/.." && pwd)

tcc_real=$root/bin/tcc
common_tccdir=$root/lib/tcc
wrap_include=$root/include
musl_include=$root/include/musl
crt_c=$common_tccdir/crt.c

if [ "${TCC_GLIBC_LIBDIRS+set}" = set ]; then
  lib_dirs=$TCC_GLIBC_LIBDIRS
else
  lib_dirs=/lib:/usr/lib:/lib32:/usr/lib32:/lib/i386-linux-gnu:/usr/lib/i386-linux-gnu
fi

find_lib() {
  name=$1
  old_ifs=$IFS
  IFS=:
  set -- $lib_dirs
  IFS=$old_ifs
  for dir do
    if [ -r "$dir/$name" ]; then
      printf '%s\n' "$dir/$name"
      return 0
    fi
  done
  printf 'missing runtime library: %s\n' "$name" >&2
  return 1
}

libc_so=$(find_lib libc.so.6)
libm_so=$(find_lib libm.so.6)
libdl_so=$(find_lib libdl.so.2)

mode=link
for arg in "$@"; do
  case "$arg" in
    -c|-E|-S|-M|-MM|-MD|-MMD|-ar|-run|-v|-vv|-print-search-dirs)
      mode=compile
      ;;
  esac
done

if [ "$mode" = link ]; then
  exec "$tcc_real" \
    -B"$common_tccdir" \
    -m32 \
    -nostdinc \
    -I"$wrap_include" \
    -isystem "$musl_include" \
    -isystem "$musl_include/bits" \
    -L/lib \
    -L/usr/lib \
    -L/lib32 \
    -L/usr/lib32 \
    -L/lib/i386-linux-gnu \
    -L/usr/lib/i386-linux-gnu \
    -nostdlib \
    "$@" \
    "$crt_c" \
    "$common_tccdir/libtcc1.o" \
    "$common_tccdir/alloca86.o" \
    "$libc_so" \
    "$libm_so" \
    "$libdl_so"
fi

exec "$tcc_real" \
  -B"$common_tccdir" \
  -m32 \
  -nostdinc \
  -I"$wrap_include" \
  -isystem "$musl_include" \
  -isystem "$musl_include/bits" \
  -L/lib \
  -L/usr/lib \
  -L/lib32 \
  -L/usr/lib32 \
  -L/lib/i386-linux-gnu \
  -L/usr/lib/i386-linux-gnu \
  "$@"
