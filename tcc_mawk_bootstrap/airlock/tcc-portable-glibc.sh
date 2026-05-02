#!/bin/sh
set -eu

case $0 in
  */*) self_dir=${0%/*} ;;
  *) self_dir=. ;;
esac
self_dir=$(CDPATH= cd -- "$self_dir" && pwd)
exec "$self_dir/tcc-driver" "$@"
