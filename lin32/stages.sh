#!/bin/sh
set -eu
cd "$(dirname "$0")"
./build.sh

build/share/cc0.elf cc_min.c build/share/lc1.elf
build/share/lc1.elf cc_min.c build/share/lc2.elf
build/share/lc2.elf cc_min.c build/share/lc3.elf
cmp build/share/lc1.elf build/share/lc2.elf
cmp build/share/lc2.elf build/share/lc3.elf
build/share/lc3.elf cc_demo.c build/share/ldemo.elf
set +e
build/share/ldemo.elf
demo_status=$?
set -e
test "$demo_status" -eq 42
sha256sum build/share/lc[123].elf build/share/ldemo.elf > build/linux-stages.sha256
cat build/linux-stages.sha256
printf '%s\n' 'LINUX_SELFHOST_COMPLETE: stages 1, 2, and 3 are byte-identical; demo exited 42.'
