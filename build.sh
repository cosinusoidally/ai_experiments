#!/bin/bash

# Build script for hello_world.c
# This script compiles the Spidermonkey embedding example against
# official Firefox 1.0.8 Spidermonkey headers and libraries
#
# Expected environment variables:
#   FIREFOX_BIN_TARBALL - Path to firefox-1.0.8.tar.gz (binary)
#   FIREFOX_SRC_TARBALL - Path to firefox-1.0.8-source.tar.bz2 (source)

set -e  # Exit on error

echo "Building hello_world.c with official Firefox 1.0.8 Spidermonkey..."

# Check if gcc is available
if ! command -v gcc &> /dev/null; then
    echo "Error: gcc is not installed"
    exit 1
fi

# Get absolute paths (expand ~ if needed)
FIREFOX_BIN_TARBALL="${FIREFOX_BIN_TARBALL/#\~/$HOME}"
FIREFOX_SRC_TARBALL="${FIREFOX_SRC_TARBALL/#\~/$HOME}"

# Verify environment variables are set
if [ -z "$FIREFOX_BIN_TARBALL" ] || [ -z "$FIREFOX_SRC_TARBALL" ]; then
    echo "Error: FIREFOX_BIN_TARBALL and FIREFOX_SRC_TARBALL environment variables must be set"
    exit 1
fi

# Verify tarballs exist
if [ ! -f "$FIREFOX_BIN_TARBALL" ]; then
    echo "Error: Firefox binary tarball not found at $FIREFOX_BIN_TARBALL"
    exit 1
fi

if [ ! -f "$FIREFOX_SRC_TARBALL" ]; then
    echo "Error: Firefox source tarball not found at $FIREFOX_SRC_TARBALL"
    exit 1
fi

# Create build directory
BUILD_DIR=$(mktemp -d)
trap "rm -rf $BUILD_DIR" EXIT

echo "Working in temporary directory: $BUILD_DIR"

# Extract Firefox binary tarball
echo "Extracting Firefox 1.0.8 binary..."
tar -xzf "$FIREFOX_BIN_TARBALL" -C "$BUILD_DIR" || {
    echo "Error: Failed to extract Firefox binary tarball"
    exit 1
}

# Find Firefox binary directory
FIREFOX_BIN_DIR=$(find "$BUILD_DIR" -type d -name "firefox" | head -1)
if [ -z "$FIREFOX_BIN_DIR" ]; then
    echo "Error: Could not find Firefox directory in binary tarball"
    exit 1
fi

echo "Found Firefox binary directory: $FIREFOX_BIN_DIR"

# Extract Firefox source tarball
echo "Extracting Firefox 1.0.8 source..."
tar -xjf "$FIREFOX_SRC_TARBALL" -C "$BUILD_DIR" || {
    echo "Error: Failed to extract Firefox source tarball"
    exit 1
}

# Find Firefox source directory
FIREFOX_SRC_DIR=$(find "$BUILD_DIR" -type d -name "mozilla" | head -1)
if [ -z "$FIREFOX_SRC_DIR" ]; then
    # Try alternate name
    FIREFOX_SRC_DIR=$(find "$BUILD_DIR" -type d -name "firefox*" ! -name "firefox" | head -1)
fi

if [ -z "$FIREFOX_SRC_DIR" ]; then
    echo "Error: Could not find Firefox source directory in source tarball"
    echo "Contents of $BUILD_DIR:"
    ls -la "$BUILD_DIR"
    exit 1
fi

echo "Found Firefox source directory: $FIREFOX_SRC_DIR"

# Look for Spidermonkey headers in source
INCLUDE_DIR=$(find "$FIREFOX_SRC_DIR" -path "*/js/src/jsapi.h" -exec dirname {} \; | head -1)

if [ -z "$INCLUDE_DIR" ] || [ ! -f "$INCLUDE_DIR/jsapi.h" ]; then
    echo "Error: Could not find jsapi.h in Firefox source"
    echo "Searching for jsapi.h..."
    find "$BUILD_DIR" -name "jsapi.h" -type f || true
    exit 1
fi

echo "Found Spidermonkey headers in: $INCLUDE_DIR"

# Look for library directory in binary
LIB_DIR="$FIREFOX_BIN_DIR/lib"
if [ ! -d "$LIB_DIR" ]; then
    echo "Attempting to locate Spidermonkey libraries..."
    LIB_DIR=$(find "$FIREFOX_BIN_DIR" -name "libjs.so*" -o -name "libmozjs.so*" | xargs dirname | head -1 2>/dev/null)
fi

if [ -z "$LIB_DIR" ] || [ ! -d "$LIB_DIR" ]; then
    echo "Error: Could not find Spidermonkey libraries in Firefox binary"
    exit 1
fi

echo "Found library directory: $LIB_DIR"
echo "Available libraries:"
ls -1 "$LIB_DIR" | grep -E "libjs|libmozjs" || echo "  (none found)"

# List extracted headers
echo "Headers found:"
ls -1 "$INCLUDE_DIR" | head -10

# Compile with extracted headers and libraries
echo "Compiling hello_world.c with XP_UNIX platform define (32-bit)..."

gcc -m32 -I. -I"$INCLUDE_DIR" \
    -L"$LIB_DIR" \
    -DXP_UNIX \
    hello_world.c \
    -o hello_world \
    -lmozjs || {
    echo "Error: Compilation failed"
    exit 1
}

echo "Build successful! Executable: ./hello_world"

# Run hello_world with LD_LIBRARY_PATH set
echo ""
echo "Running hello_world..."
LD_LIBRARY_PATH="$LIB_DIR" ./hello_world
