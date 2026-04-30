#!/bin/sh

set -eu

if [ "$#" -lt 1 ]; then
    echo "usage: $0 /path/to/i386-binary [args...]" >&2
    exit 1
fi

target=$1
shift

exec "$target" "$@"
