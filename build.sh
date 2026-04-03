#!/bin/bash

# Build script for hello_world.c
# This script compiles the Spidermonkey embedding example against
# official Firefox 1 era Mozilla Spidermonkey sources
#
# Expected environment variables:
#   FIREFOX_TARBALL - Path to firefox-1.0.tar.gz
#   SPIDERMONKEY_TARBALL - Path to js185-1.0.0.tar.gz

set -e  # Exit on error

echo "Building hello_world.c with official Firefox 1 Spidermonkey..."

# Check if gcc is available
if ! command -v gcc &> /dev/null; then
    echo "Error: gcc is not installed"
    exit 1
fi

# Verify environment variables are set
if [ -z "$FIREFOX_TARBALL" ] || [ -z "$SPIDERMONKEY_TARBALL" ]; then
    echo "Error: FIREFOX_TARBALL and SPIDERMONKEY_TARBALL environment variables must be set"
    echo "Example:"
    echo "  export FIREFOX_TARBALL=~/firefox-1.0.tar.gz"
    echo "  export SPIDERMONKEY_TARBALL=~/js185-1.0.0.tar.gz"
    exit 1
fi

# Verify tarballs exist
if [ ! -f "$FIREFOX_TARBALL" ]; then
    echo "Error: Firefox tarball not found at $FIREFOX_TARBALL"
    exit 1
fi

if [ ! -f "$SPIDERMONKEY_TARBALL" ]; then
    echo "Error: Spidermonkey tarball not found at $SPIDERMONKEY_TARBALL"
    exit 1
fi

# Create build directory
BUILD_DIR=$(mktemp -d)
trap "rm -rf $BUILD_DIR" EXIT

echo "Working in temporary directory: $BUILD_DIR"

# Extract Firefox 1.0 tarball
echo "Extracting Firefox 1.0..."
tar -xzf "$FIREFOX_TARBALL" -C "$BUILD_DIR" || {
    echo "Error: Failed to extract Firefox tarball"
    exit 1
}

# Find Firefox directory
FIREFOX_DIR=$(find "$BUILD_DIR" -type d -name "firefox" | head -1)
if [ -z "$FIREFOX_DIR" ]; then
    echo "Error: Could not find Firefox directory in tarball"
    exit 1
fi

echo "Found Firefox directory: $FIREFOX_DIR"

# Extract Spidermonkey source tarball
echo "Extracting Spidermonkey 1.x source..."
tar -xzf "$SPIDERMONKEY_TARBALL" -C "$BUILD_DIR" || {
    echo "Error: Failed to extract Spidermonkey tarball"
    exit 1
}

# Find Spidermonkey source directory
SPIDERMONKEY_DIR=$(find "$BUILD_DIR" -type d -name "js-*" | head -1)
if [ -z "$SPIDERMONKEY_DIR" ]; then
    echo "Error: Could not find Spidermonkey directory in tarball"
    exit 1
fi

echo "Found Spidermonkey directory: $SPIDERMONKEY_DIR"

# Extract library from Firefox distribution
LIB_DIR="$FIREFOX_DIR/lib"
if [ ! -d "$LIB_DIR" ]; then
    echo "Attempting to locate Spidermonkey libraries in Firefox directory..."
    LIB_DIR=$(find "$FIREFOX_DIR" -name "libjs.so*" -o -name "libmozjs.so*" | xargs dirname | head -1 2>/dev/null)
fi

if [ -z "$LIB_DIR" ] || [ ! -d "$LIB_DIR" ]; then
    echo "Error: Could not find Spidermonkey libraries in Firefox distribution"
    exit 1
fi

echo "Found library directory: $LIB_DIR"

# Copy Spidermonkey headers to a local include directory
INCLUDE_DIR="$BUILD_DIR/include"
mkdir -p "$INCLUDE_DIR"

if [ -f "$SPIDERMONKEY_DIR/js/src/jsapi.h" ]; then
    cp "$SPIDERMONKEY_DIR/js/src"/*.h "$INCLUDE_DIR/" 2>/dev/null || true
    echo "Extracted headers to $INCLUDE_DIR"
elif [ -d "$SPIDERMONKEY_DIR/js/src" ]; then
    cp "$SPIDERMONKEY_DIR/js/src"/*.h "$INCLUDE_DIR/" 2>/dev/null || true
    echo "Extracted headers to $INCLUDE_DIR"
else
    echo "Error: Could not find jsapi.h in Spidermonkey source"
    exit 1
fi

# List extracted headers
echo "Headers found:"
ls -1 "$INCLUDE_DIR" | head -10

# Compile with extracted headers and libraries
echo "Compiling hello_world.c..."
gcc -I"$INCLUDE_DIR" \
    -L"$LIB_DIR" \
    hello_world.c \
    -o hello_world \
    -Wl,-rpath,"$LIB_DIR" \
    -ljs 2>/dev/null || {
    # Fallback: try alternative library name
    echo "Trying alternative library name (libmozjs)..."
    gcc -I"$INCLUDE_DIR" \
        -L"$LIB_DIR" \
        hello_world.c \
        -o hello_world \
        -Wl,-rpath,"$LIB_DIR" \
        -lmozjs || {
        echo "Error: Compilation failed with both -ljs and -lmozjs"
        echo "Available libraries in $LIB_DIR:"
        ls -1 "$LIB_DIR" | grep -E "libjs|libmozjs" || echo "  (none found)"
        exit 1
    }
}

echo "Build successful! Executable: ./hello_world"
