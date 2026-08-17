# MMVM v2 JavaScript integration tests

This directory contains the JavaScript examples, compatibility layer, and
framebuffer benchmark developed against `mmvm_v2`. The interpreter and its C
sources remain in the separate `mmvm_v2` repository.

## Required checkout layout

The build scripts use relative paths. Arrange the repositories and Firefox
files as siblings under one workspace directory:

```text
workspace/
├── ai_experiments/
│   └── mmvm_v2_tests/
├── firefox-1.0.8/
│   ├── firefox-1.0.8-source.tar.bz2
│   ├── firefox-1.0.8.tar.gz
│   ├── js_src/
│   │   └── src/
│   │       └── jsapi.h
│   └── lib/
│       ├── libmozjs.so
│       ├── libnspr4.so
│       ├── libplc4.so
│       └── libplds4.so
└── mmvm_v2/
    ├── mk_min
    ├── js_min_linux.c
    └── artifacts/
```

`mk_min` specifically expects the Firefox header directory at
`../firefox-1.0.8/js_src/src` and its libraries at
`../firefox-1.0.8/lib`, relative to the `mmvm_v2` checkout.

## Obtain Firefox 1.0.8

The user must obtain these two historical release files from the Mozilla
Firefox 1.0.8 release archive. They are not included in either repository:

- `firefox-1.0.8-source.tar.bz2` — Firefox 1.0.8 source archive.
- `firefox-1.0.8.tar.gz` — 32-bit Linux i686 en-GB binary archive.

Mozilla's historical releases are under:

```text
https://archive.mozilla.org/pub/firefox/releases/1.0.8/
```

The corresponding release paths are:

```text
source/firefox-1.0.8-source.tar.bz2
linux-i686/en-GB/firefox-1.0.8.tar.gz
```

Download them yourself from the Mozilla release site, then place both files
directly in the `firefox-1.0.8` directory shown in the sibling layout above.
The MMVM build does not fetch anything from the Internet.

The exact local archives used to develop and test this code have these SHA-256
digests:

```text
a3b158d887f93aecab010832de8275256096173f7c21694091f9feaeedc74e78  firefox-1.0.8-source.tar.bz2
c4274bc1c8656d1cbdb39c3247029c0cb9d152876b9476f86626118562782f83  firefox-1.0.8.tar.gz
```

Verify the downloaded files before extracting them:

```sh
# Run from the workspace directory containing the sibling repositories.
cd firefox-1.0.8

sha256sum -c <<'EOF'
a3b158d887f93aecab010832de8275256096173f7c21694091f9feaeedc74e78  firefox-1.0.8-source.tar.bz2
c4274bc1c8656d1cbdb39c3247029c0cb9d152876b9476f86626118562782f83  firefox-1.0.8.tar.gz
EOF
```

Both lines must report `OK`. A binary archive for another locale may contain
equivalent SpiderMonkey libraries but will not necessarily have the same
whole-archive SHA-256 digest; the documented and tested archive is the en-GB
Linux i686 build.

## Prepare `firefox-1.0.8`

Start with a new `firefox-1.0.8` directory containing only the two archives.
The full Firefox browser does not need to be installed or built. Extract only
the SpiderMonkey source subtree and the four shared libraries required by
`js_min.exe`:

```sh
# Run from the workspace directory containing the sibling repositories.
mkdir -p firefox-1.0.8
cd firefox-1.0.8

tar -xjf firefox-1.0.8-source.tar.bz2 mozilla/js
mv mozilla/js js_src
rmdir mozilla

tar -xzf firefox-1.0.8.tar.gz \
  firefox/libmozjs.so \
  firefox/libnspr4.so \
  firefox/libplc4.so \
  firefox/libplds4.so
mv firefox lib
```

Confirm that the expected header and libraries exist:

```sh
test -f js_src/src/jsapi.h
test -f lib/libmozjs.so
test -f lib/libnspr4.so
test -f lib/libplc4.so
test -f lib/libplds4.so

file lib/libmozjs.so lib/libnspr4.so lib/libplc4.so lib/libplds4.so
```

The four libraries must be 32-bit Intel 80386 ELF shared objects. The tested
`libmozjs.so` reports `ELF 32-bit LSB shared object, Intel 80386`.

## Build `artifacts/js_min.exe`

The host needs a C compiler capable of producing 32-bit i386 binaries, 32-bit
libc development files, a 32-bit runtime loader such as `ld-linux.so.2`, `tar`,
`bzip2`, and the ordinary ELF inspection tools used by the script.

Use the `fix_mk` branch, where `mk_min` passes `-m32` to both compilation and
linking:

```sh
# Run from the workspace directory containing the sibling repositories.
cd mmvm_v2
git switch fix_mk

LD_LIBRARY_PATH=../firefox-1.0.8/lib ./mk_min
```

Do not add an rpath. Set `LD_LIBRARY_PATH` whenever building or running the
interpreter.

`mk_min` performs all of the following:

1. Runs `mk_clean`.
2. Compiles `js_min_linux.c` as a 32-bit object in `artifacts/js.o`.
3. Links `artifacts/js_min.exe` against the Firefox 1.0.8 `libmozjs.so`.
4. Runs `ldd` on the result.
5. Runs the bundled `mandel.js` smoke test.

Warning: `mk_clean` removes and recreates the entire `mmvm_v2/artifacts`
directory. Treat everything in that directory, including `artifacts/www`, as
temporary.

Verify the result explicitly:

```sh
file artifacts/js_min.exe

LD_LIBRARY_PATH=../firefox-1.0.8/lib \
  ldd artifacts/js_min.exe
```

The executable must be an ELF 32-bit Intel 80386 binary, and `ldd` must resolve
`libmozjs.so`, `libnspr4.so`, `libplc4.so`, and `libplds4.so` from the prepared
Firefox directory.

## Run tests from this directory

Relative application loads such as `node_compat/libc.js` are resolved from the
current directory. Run the examples with
`ai_experiments/mmvm_v2_tests` as the working directory:

```sh
# Run from the workspace directory containing the sibling repositories.
cd ai_experiments/mmvm_v2_tests

MMVM_ROOT=../../mmvm_v2
MOZJS_LIB=../../firefox-1.0.8/lib
```

### Direct libc FFI hello

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" hello.js
```

Expected output:

```text
Hello, world!
```

### libc-only static web server

`net.js` uses only libc through the MMVM FFI for its network and filesystem
operations. It listens on all interfaces and port 8000 by default:

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" net.js \
  8000 --bind 127.0.0.1 --directory .
```

Then request `http://127.0.0.1:8000/`. It supports GET and HEAD, binary files,
`index.html`, generated directory listings, redirects, common MIME types, and
Python-style access logs on stdout.

### Node-compatible hello server

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  node_runner.js node_hello.js 8000 127.0.0.1
```

The same application source runs under Node.js without the compatibility
runner:

```sh
node node_hello.js 8000 127.0.0.1
```

### Node-compatible static web server

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  node_runner.js node_web.js \
  8000 --bind 127.0.0.1 --directory .
```

The same source runs directly under Node.js:

```sh
node node_web.js 8000 --bind 127.0.0.1 --directory .
```

The compatibility filesystem module supplies synchronous and callback-based
`stat`, `readdir`, and `readFile`. Socket I/O is non-blocking and poll-driven.
Compatibility-layer file callbacks are queued asynchronously, although the
underlying libc regular-file operation runs on the event-loop thread because
there is no native worker pool.

### Reusable X11 modules

The X11 example is split into three CommonJS files so additional demos can
reuse the transport and drawing helpers:

- `node_x11.js` implements the Xauthority reader, Unix-domain connection, core
  X11 protocol, window lifecycle, keyboard mapping, input events, RGB
  framebuffer, frame pacing, and `PutImage` uploads. Requiring it has no side
  effects.
- `demo_common.js` requires `node_x11` and exports shared option parsing,
  bitmap-font text and caret support, framebuffer pointer painting, keysyms,
  and the window factory.
- `demo1.js` is the executable original demo: gradient, pointer glow, mouse
  ripple, editable click-to-type text, buttons, and palette changes.

A new program can load the low-level framebuffer module directly:

```js
var x11 = require("./node_x11.js");

var window = x11.createFramebufferWindow({
    width: 256,
    height: 192,
    fps: 20,
    draw: function (framebuffer) {
        framebuffer.setPixel(10, 10, 255, 0, 0);
    }
});
```

Alternatively, a demo can use the common helpers:

```js
var common = require("./demo_common.js");
var options = common.parseOptions(process.argv, "demo2.js");
options.draw = function (framebuffer) {
    framebuffer.setPixel(20, 20, 0, 255, 0);
};
var window = common.createWindow(options);
```

`createFramebufferWindow` accepts `width`, `height`, `fps`, `title`,
`instanceName`, `className`, and callbacks named `draw`, `ready`,
`keyboardMapping`, `pointerMove`, `buttonPress`, `buttonRelease`, `keyPress`,
`expose`, `error`, and `close`. The returned framebuffer-window object exposes
`width`, `height`, `fps`, `setPixel`, `requestFrame`, `pointer`, and `close`.

These are local CommonJS modules. There is no npm dependency, `node_modules`
directory, package lookup, or `package.json`. The MMVM runner provides only the
relative module loading needed by these files, including `.js` extension
resolution, `module.exports`, and module caching.

### X11 RGB framebuffer demo 1

`DISPLAY` must select a local X server. For a local display such as `:1`, the
X11/Xtrans Unix-domain transport convention maps the display number to
`/tmp/.X11-unix/X1`. This is the conventional interoperable pathname for local
X11 servers rather than a checkout- or machine-specific project path, so the
demo derives `<n>` from `DISPLAY` and uses that standard socket location.
`XAUTHORITY` may select the authority file; otherwise the demo derives the
authority filename from the current user's `HOME` environment variable.

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  node_runner.js demo1.js \
  --size 256x192 --fps 20
```

The same source runs directly under Node.js:

```sh
node demo1.js --size 256x192 --fps 20
```

The pointer, bitmap font, text caret, button effects, and background are all
painted directly into the RGB framebuffer by JavaScript. No X11 text or drawing
primitive is used. Left-click places the text caret; printable keys draw at the
clicked location. F1 changes the palette and Escape closes the demo.

On a compatible little-endian, depth-24 X server using 32 bits per pixel, the
MMVM path writes one packed server pixel with `poke32`. Other server formats
use the portable RGB conversion path.

### Framebuffer drawing benchmark

The arguments are width, height, frame count, and storage mode:

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  draw_bench.js 256 192 5 native32
```

Storage modes are:

- `array`: JavaScript byte-array storage.
- `native`: native storage with three `poke8` calls per pixel.
- `native32`: native storage with one packed little-endian `poke32` per pixel.

## Compatibility scope

The compatibility layer is deliberately narrow. It implements the built-in
Node.js APIs required by these examples, not npm or a general Node runtime.
All raw libc `ffi_call` operations are isolated in `node_compat/libc.js`.
Network I/O uses ordinary sockets, `fcntl(O_NONBLOCK)`, and `poll`; timer
scheduling uses `gettimeofday` to remain conservative about old Linux kernel
interfaces.

See [NODE_COMPAT_PLAN.md](NODE_COMPAT_PLAN.md) for the original architecture,
constraints, and acceptance criteria.
