#!/usr/bin/env bash
set -euo pipefail

# Resolve from lin32 so QCOW2 backing paths also work from build/.
base="$(cd ../../xp && pwd -P)/winxp.img"
overlay=build/xp-interactive.qcow2
mkdir -p build
if [[ ! -f "$overlay" ]]; then
    qemu-img create -f qcow2 -F raw -b "$base" "$overlay"
fi

# Attach the test files when a transfer disk has already been prepared.
transfer=()
if [[ -f build/transfer.img ]]; then
    transfer=(-drive file=build/transfer.img,format=raw,if=ide,index=1,snapshot=on)
fi

exec qemu-system-i386 \
    -m 256 \
    -display gtk \
    -blockdev "driver=file,node-name=xp-base-file,filename=$base,read-only=on" \
    -blockdev driver=raw,node-name=xp-base,file=xp-base-file,read-only=on \
    -blockdev "driver=file,node-name=xp-overlay-file,filename=$overlay" \
    -blockdev driver=qcow2,node-name=xp-overlay,file=xp-overlay-file,backing=xp-base \
    -device ide-hd,drive=xp-overlay,bus=ide.0,unit=0 \
    "${transfer[@]}" \
    -nic none \
    -rtc base=localtime \
    -no-reboot
