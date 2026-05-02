#!/bin/sh
set -eu

mkdir -p /opt
( cd /opt && /bin/tar-1.13 -xf /work/tcc-portable.tar )

/bin/gzip.bin -dc /work/gzip-1.3.3-i386-2.tgz > /tmp/gzip-package.tar
rm -f /bin/gzip /bin/gunzip /bin/zcat
rm -f /usr/bin/gzip /usr/bin/gunzip /usr/bin/zcat /usr/bin/zcmp /usr/bin/zegrep /usr/bin/zfgrep
( cd / && /bin/tar-1.13 -xf /tmp/gzip-package.tar )
( cd / && /bin/sh /install/doinst.sh )

PATH=/opt/tcc-portable/bin:/bin:/usr/bin
export PATH

printf '#include <stdio.h>\nint main(void){puts("portable system ok");return 0;}\n' > /tmp/hello.c
tcc-glibc /tmp/hello.c -o /tmp/hello

hello_out=$(/tmp/hello)
test "x$hello_out" = "xportable system ok"

printf 'slackware tcc portable gzip test\n' > /tmp/gzip-input.txt
/bin/gzip -9c /tmp/gzip-input.txt > /tmp/gzip-input.txt.gz
roundtrip=$(/bin/gzip -dc /tmp/gzip-input.txt.gz)
test "x$roundtrip" = "xslackware tcc portable gzip test"

test -x /bin/gzip
test ! -L /bin/gzip
test -x /opt/tcc-portable/bin/tcc-glibc

printf 'airlock portable system test complete\n'
