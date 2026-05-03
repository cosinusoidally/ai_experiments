#!/bin/sh
set -eu

cd /work

printf 'packaged gzip test\n' > /tmp/gzip.in
/bin/gzip -9c /tmp/gzip.in > /tmp/gzip.in.gz
test "$(/bin/gzip -dc /tmp/gzip.in.gz)" = 'packaged gzip test'

printf 'BEGIN { print "packaged mawk ok" }\n' > /tmp/mawk.awk
test "$(/usr/bin/mawk -f /tmp/mawk.awk /dev/null)" = 'packaged mawk ok'

test "$(/bin/bash -c 'echo packaged bash ok')" = 'packaged bash ok'

mkdir -p /tmp/tar.in /tmp/tar.out
printf 'packaged tar ok\n' > /tmp/tar.in/file.txt
/bin/tar -cf /tmp/tar-test.tar -C /tmp/tar.in .
/bin/tar -xf /tmp/tar-test.tar -C /tmp/tar.out
test "$(cat /tmp/tar.out/file.txt)" = 'packaged tar ok'

printf 'old\n' > /tmp/patch.txt
printf '%s\n' '--- patch.txt' '+++ patch.txt' '@@ -1 +1 @@' '-old' '+new' \
  > /tmp/patch.diff
cd /tmp
/usr/bin/patch -s < /tmp/patch.diff
test "$(cat /tmp/patch.txt)" = 'new'
test "$(/bin/sed 's/old/new/' /tmp/patch.txt)" = 'new'
cd /work

/bin/sh /work/inside-airlock.sh

/bin/tar -cf /work/tcc-portable-rebuilt.tar -C /work/bootstrap tcc-portable
printf 'airlock packaged portable rebuild complete\n'
