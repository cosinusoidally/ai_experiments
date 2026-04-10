#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARTIFACTS=$ROOT/artifacts

mkdir -p "$ARTIFACTS"
rm -f "$ARTIFACTS"/*
touch "$ARTIFACTS"/placeholder
