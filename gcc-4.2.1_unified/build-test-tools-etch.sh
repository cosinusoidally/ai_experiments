#!/bin/sh

# Build the GCC testsuite harness on Debian Etch using only upstream release
# archives.  Etch lacks xz, so the copied Jammy Debian patch archives are kept
# for provenance but are not required or unpacked.

set -eu

script_dir=`dirname "$0"`
script_dir=`CDPATH= cd "$script_dir" && pwd`
work_dir=$script_dir/build-test-tools-etch
prefix=/tmp/test_tools
jobs=${JOBS-1}
triplet=i686-pc-linux-gnu

fail()
{
  echo "$*" >&2
  exit 1
}

case $jobs in
  ''|*[!0-9]*|0) fail "JOBS must be a positive integer" ;;
esac

test "`dpkg --print-architecture`" = i386 || fail "Etch chroot must be i386"
for tool in gcc make tar sed grep find; do
  command -v "$tool" >/dev/null 2>&1 || fail "missing required tool: $tool"
done

for archive in \
  tcl8.6_8.6.12+dfsg.orig.tar.gz \
  expect_5.45.4.orig.tar.gz \
  dejagnu_1.6.2.orig.tar.gz
do
  test -f "$script_dir/$archive" || fail "missing archive: $archive"
done

case $work_dir in
  "$script_dir"/*) ;;
  *) fail "unsafe work directory: $work_dir" ;;
esac
case $prefix in
  /tmp/test_tools) ;;
  *) fail "unsafe install prefix: $prefix" ;;
esac
test ! -d "$work_dir" || find "$work_dir" -depth -delete
test ! -d "$prefix" || find "$prefix" -depth -delete
mkdir -p "$work_dir" "$prefix"

export PATH=$prefix/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LANG=C
export LC_ALL=C

tar -xzf "$script_dir/tcl8.6_8.6.12+dfsg.orig.tar.gz" -C "$work_dir"
mkdir "$work_dir/build-tcl"
cd "$work_dir/build-tcl"
LDFLAGS="-Wl,-rpath,$prefix/lib" \
  "$work_dir/tcl8.6.12/unix/configure" \
    --build=$triplet --host=$triplet --prefix="$prefix" \
    --enable-shared --enable-threads
make -j"$jobs"
make install
make install-private-headers

cd "$script_dir"
tar -xzf "$script_dir/expect_5.45.4.orig.tar.gz" -C "$work_dir"
mkdir "$work_dir/build-expect"
cd "$work_dir/build-expect"
CPPFLAGS="-I$prefix/include" \
LDFLAGS="-Wl,-rpath,$prefix/lib -L$prefix/lib" \
  "$work_dir/expect5.45.4/configure" \
    --build=$triplet --host=$triplet --prefix="$prefix" \
    --with-tcl="$prefix/lib" --with-tclinclude="$prefix/include" \
    --enable-shared
make -j"$jobs"
make install

cd "$script_dir"
tar -xzf "$script_dir/dejagnu_1.6.2.orig.tar.gz" -C "$work_dir"
mkdir "$work_dir/build-dejagnu"
cd "$work_dir/build-dejagnu"
"$work_dir/dejagnu-1.6.2/configure" \
  --build=$triplet --host=$triplet --prefix="$prefix"
make -j"$jobs"
make install

test -x "$prefix/bin/tclsh8.6" || fail "Tcl was not installed"
test -x "$prefix/bin/expect" || fail "Expect was not installed"
test -x "$prefix/bin/runtest" || fail "DejaGnu was not installed"

echo "Installed test tools:"
echo 'puts [info patchlevel]' | "$prefix/bin/tclsh8.6"
"$prefix/bin/expect" -v
"$prefix/bin/runtest" --version
