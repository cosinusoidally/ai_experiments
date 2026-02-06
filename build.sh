#!/bin/bash

# Build script for hello_world.c
# This script compiles the Spidermonkey embedding example

set -e  # Exit on error

echo "Building hello_world.c..."

# Check if gcc is available
if ! command -v gcc &> /dev/null; then
    echo "Error: gcc is not installed"
    exit 1
fi

# Check if jsapi.h is available (Spidermonkey development headers)
# Try common locations and pkg-config
if pkg-config --exists js 2>/dev/null; then
    echo "Found Spidermonkey via pkg-config"
    CFLAGS=$(pkg-config --cflags js)
    LIBS=$(pkg-config --libs js)
    gcc $CFLAGS hello_world.c -o hello_world $LIBS
elif [ -f "/usr/include/jsapi.h" ]; then
    echo "Found jsapi.h in /usr/include"
    gcc hello_world.c -o hello_world -ljs
else
    echo "Warning: Spidermonkey development headers not found"
    echo "Spidermonkey may need to be installed: apt-get install libmozjs-dev (or equivalent)"
    exit 1
fi

echo "Build successful! Executable: ./hello_world"