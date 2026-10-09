#!/bin/sh
set -eu

if [ -e build/monitor.sock ]; then
    printf '%s\n' 'Stop the XP test VM before cleaning its disks and logs.' >&2
    exit 1
fi
rm -rf build __pycache__
printf '%s\n' 'Cleaned build artifacts and Python caches.'
