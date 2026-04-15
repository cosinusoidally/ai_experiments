#!/bin/sh
set -eu

if [ "$#" -lt 1 ]; then
    echo "usage: run-i386.sh command [args...]" >&2
    exit 2
fi

exec "$@"
