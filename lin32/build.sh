#!/bin/sh
set -eu
cd "$(dirname "$0")"

tcc_root=${LIN32_TCC_ROOT:-/tmp/tcc-cross}
mkdir -p build/share

"$tcc_root/bin/i386-win32-tcc" -Wall lin32.c entry.S -o build/share/lin32.exe

for name in hello checks badmem illegal readonly stack fileio heap; do
    "$tcc_root/bin/i386-tcc" -nostdlib -static \
        -Wl,-Ttext=0x08048000 "tests/$name.c" \
        -o "build/share/$name.elf"
done

"$tcc_root/bin/i386-tcc" -nostdlib -static -Wl,-Ttext=0x08048000 \
    cc_min.c -o build/share/cc0.elf
cp cc_min.c cc_demo.c build/share/

# Malformed loader fixtures: TCC 0.9.27's ELF32 program headers start at byte 52.
patch_fixture() {
    cp build/share/hello.elf "build/share/$1.elf"
    printf '%b' "$3" | dd of="build/share/$1.elf" bs=1 seek="$2" conv=notrunc 2>/dev/null
}
dd if=build/share/hello.elf of=build/share/short.elf bs=1 count=20 2>/dev/null
patch_fixture headers 28 '\0360\0377\0377\0377'
patch_fixture dynamic 16 '\0003\0000'
patch_fixture bounds 68 '\0377\0377\0377\0377'
patch_fixture entry 24 '\0170\0126\0064\0022'
patch_fixture interp 52 '\0003\0000\0000\0000'

# Preserve Windows CRLF line endings without a Python preprocessing step.
while IFS= read -r line; do
    printf '%s\r\n' "$line"
done < run.cmd > build/share/run.cmd
while IFS= read -r line; do
    printf '%s\r\n' "$line"
done < stages.cmd > build/share/stages.cmd
printf '%s\n' 'Built lin32.exe and all test fixtures in build/share/.'
