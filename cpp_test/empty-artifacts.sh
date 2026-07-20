#!/bin/sh
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ARTIFACTS=$HERE/artifacts

mkdir -p "$ARTIFACTS"
find "$ARTIFACTS" -mindepth 1 -depth -delete
touch "$ARTIFACTS/placeholder"
