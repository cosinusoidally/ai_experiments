# MMVM v2 JavaScript integration tests

This directory contains the JavaScript examples, compatibility layer, and
framebuffer benchmark developed against `mmvm_v2`. The interpreter and its C
sources remain in the separate `mmvm_v2` repository.

The existing JavaScript-only Node compatibility implementation is described in
`NODE_COMPAT_PLAN.md`. The proposed guest JavaScript VM, guest-owned garbage
collector and Buffer lifetime model, portable bytecode, generated-JavaScript
backend, and optional i386 JIT are described in `GUEST_VM_PLAN.md`.

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
  framebuffer, animation-frame pacing, double buffering, and `PutImage`
  uploads. Requiring it has no side effects.
- `demo_common.js` requires `node_x11` and exports shared option parsing,
  bitmap-font text and caret support, framebuffer pointer painting, keysyms,
  the window factory, and the shared frame-rate counter.
- `demo1.js` is the executable original demo: gradient, pointer glow, mouse
  ripple, editable click-to-type text, buttons, and palette changes.
- `demo2.js` is a software-rendered, procedurally generated anti-gravity racing
  vehicle with mouse-controlled rotation, movement, and scaling.
- `demo3.js` isolates full-frame X11 upload performance with a fixed background
  and a dirty-region sine-wave text animation.
- `demo4.js` extends that blit test with a reproducible procedural material,
  generated normal map, surface lighting, and animated normal-mapped lettering.
- `demo5.js` extends the demo2 software rasterizer with five procedural height
  mapped materials, tangent-space normal mapping, and moving per-pixel lighting.
- `demo6.js` is a playable original Welsh-upland rally level with a chase
  camera, continuous driving controls, five AI competitors, scenery, and laps.
- `demo7.js` retains the complete demo6 game and native output resolution while
  refining its software rasterizer and static-scene path for both MMVM and
  Node.js performance.

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
`keyRelease`, `expose`, `error`, and `close`. The returned framebuffer-window
object exposes `width`, `height`, `fps`, `setPixel`, `requestFrame`, `pointer`,
and `close`.
Once X11 setup has completed, it also exposes `pixels`, `pixelAddress`,
`pixelStride`, and `pixelFormat` to draw code. `pixelFormat` is `bgrx32le` when
the framebuffer can be uploaded directly in the common little-endian X11
depth-24 layout; otherwise it is `rgb24` and `setPixel` provides the portable
conversion path. `pixelAddress` is the MMVM native allocation address and is
zero when the backing buffer does not expose one, as with Node.js.

The renderer owns two client-side framebuffer allocations and never reuses one
until the nonblocking socket reports that its complete upload has been handed
off. X11 `PutImage` bands target an off-screen server pixmap; after all bands,
one ordered `CopyArea` presents the completed pixmap to the window. This keeps
large frames from exposing partially updated horizontal bands. Redraw requests
are collapsed while one upload is in flight, so animation does not build a
queue of stale frames.

The MMVM compatibility globals include `requestAnimationFrame` and
`cancelAnimationFrame`. `node_x11.js` uses animation-frame callbacks for redraw
pacing and supplies equivalent timer-backed behavior when running directly
under Node.js, whose built-in APIs do not define browser animation frames. The
callbacks follow persistent absolute 60 Hz deadlines instead of adding a fresh
timer delay after every completed upload. Application FPS intervals retain the
floating-point value `1000 / fps`, and a callback which matures during an X11
upload is consumed as soon as that single in-flight upload completes. This
allows timing and upload to overlap without weakening framebuffer ownership or
queueing stale frames. No XShm extension or native Node.js add-on is used.

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

The demo accepts these diagnostic switches:

- `--fps-counter` displays the measured frame rate in the framebuffer and is
  the default; `--no-fps-counter` hides it.
- `--debug-events` logs keyboard and mouse-button events and is the default;
  `--no-debug-events` suppresses those lines. Debug mode also prints a rolling
  frame-rate sample to stdout every five seconds.

The shared counter is painted with the JavaScript bitmap font after the demo's
draw callback, so it does not use an X11 text or overlay API. Either the
on-screen counter or debug frame-rate logging requests continuous frames so
the measurement reflects actual drawing and upload throughput. With both
features disabled, the window redraws only for X11 events or an explicit
`requestFrame()` call.

The pointer, bitmap font, text caret, button effects, and background are all
painted directly into the RGB framebuffer by JavaScript. No X11 text or drawing
primitive is used. Left-click places the text caret; printable keys draw at the
clicked location. F1 changes the palette and Escape closes the demo.

On a compatible little-endian, depth-24 X server using 32 bits per pixel, the
demo writes its full background directly to the exposed framebuffer: MMVM uses
`poke32` with `pixelAddress`, while Node.js uses the built-in Buffer's
`writeUInt32LE`. This avoids a bounds-checked `setPixel` call for every
background pixel. The much smaller font, caret, and pointer drawing paths still
use `setPixel`; other server formats use it as the portable RGB conversion
path for the entire frame.

### X11 software 3D renderer demo 2

Run the software renderer through MMVM with:

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  node_runner.js demo2.js \
  --size 256x192 --fps 20
```

Or run the same source directly under Node.js:

```sh
node demo2.js --size 256x192 --fps 20
```

`demo2.js` implements the complete 3D pipeline in JavaScript: model
transformation, perspective projection, back-face culling, a per-pixel depth
buffer, triangle filling, lighting, perspective-correct texture coordinates,
and nearest-neighbour texture sampling.

The model is an original low-poly vehicle assembled deterministically at
startup by JavaScript mesh-building functions. Its tapered split-level hull,
swept lifting plates, twin propulsion booms, canopy, stabilizer fins, intakes,
underside equipment, and emissive exhaust blocks are all derived from numeric
design parameters. It evokes broad late-1990s science-fiction racing design
without loading or reproducing a vehicle from a game.

Five deterministic 32x32 procedural materials provide graphite hull panels,
reflective canopy glass, warning-striped machinery, coral identification
markings, and emissive propulsion surfaces. Coordinate formulas provide all
panel lines, borders, stripes, reflections, and glow patterns, so every run
generates exactly the same model and textures. There are no model files, image
files, random external inputs, or decoding dependencies. Completed pixels are
written directly into the packed framebuffer when the X11 format permits it.
X11 is used only to create the window, receive input, and upload the finished
framebuffer.

The default camera view starts above the vehicle and looks slightly down at it,
with the long axis of the model presented diagonally. Four labels at the top of
the framebuffer are clickable controls:

- Click `ROT` (`ROTATE` in a wide window), then left-drag anywhere below the
  toolbar to rotate.
- Click `MOVE`, then left-drag to move the model.
- Click `SCALE`, then left-drag vertically to resize the model. Horizontal
  movement provides a smaller scaling adjustment as well.
- Click `AUTO` to toggle slow automatic rotation. It is active by default and
  has a cyan underline while enabled. Automatic motion is based on elapsed
  time, so its speed is independent of the achieved frame rate; it pauses
  during a manual drag and resumes on release. Each rendered frame consumes the
  full wall-clock delta without clamping slow frames, so low frame rates make
  motion less smooth but do not make the rotation run slowly.

Consequently, all three operations work with a one-button mouse or a touchpad
which presents itself as an ordinary one-button mouse. No wheel, simulated
middle button, multitouch gesture, or touchpad-specific code is required.
When available, the mouse wheel also scales, middle-drag scales, and right-drag
moves. Keys `1`, `2`, and `3` select the three transform modes, `A` toggles
automatic rotation, `R` resets the model and camera angle, and Escape closes
the window.

The shared `--fps-counter`, `--no-fps-counter`, `--debug-events`, and
`--no-debug-events` options work exactly as in `demo1.js`.

### X11 full-frame blit benchmark demo 3

Run the blit benchmark through MMVM with:

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  node_runner.js demo3.js \
  --size 640x480 --fps 20
```

Or run the same source directly under Node.js:

```sh
node demo3.js --size 640x480 --fps 20
```

`demo3.js` generates a deterministic grid, diagonal-line, and star pattern in
a packed background buffer. Each of the two client framebuffers receives that
complete background once. Thereafter, each buffer remembers the positions at
which it last contained the eleven glyphs in `Hello world`. Reusing that buffer
restores only those old glyph rectangles from the fixed background and paints
the glyphs at new sine-wave positions. The dirty-aware FPS label is restored
only when its displayed value changes.

Under MMVM, background restoration reads packed pixels with `peek32`, glyph
sprite blitting reads packed source pixels with `peek32`, and affected
framebuffer pixels are written with `poke32`, all directly in `demo3.js`. The
same source uses built-in `Buffer.readUInt32LE` and `Buffer.writeUInt32LE` under
Node.js. This benchmark consequently requires the common little-endian BGRX
32-bit X11 framebuffer format.

The text wave phase is calculated from elapsed wall-clock time rather than a
frame count. A lower frame rate produces larger positional steps but does not
slow the animation. After the two initial full-background copies, JavaScript
normally touches only a few thousand dirty pixels per frame. Nevertheless,
`node_x11.js` uploads the entire width-by-height framebuffer to the server-side
back pixmap and presents it with `CopyArea` on every animation frame. Console
FPS lines explicitly count these complete framebuffer blits, making this a
transport and presentation benchmark rather than a full-screen drawing-code
benchmark.

Escape closes the benchmark. The standard resolution, FPS limit, on-screen
counter, and debug-console options are supported.

### X11 procedural normal-mapping demo 4

Run the normal-mapping demo through MMVM with:

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  node_runner.js demo4.js \
  --size 256x192 --fps 20
```

Or run the same source directly under Node.js:

```sh
node demo4.js --size 256x192 --fps 20
```

`demo4.js` is derived from the `demo3.js` dirty-draw/full-upload test. At
startup it reproducibly generates three packed images entirely in JavaScript:

1. An albedo texture containing alternating hammered copper and blue plates,
   recessed joins, raised borders, luminous circuit traces, and rivets.
2. A height map for those material features.
3. A tangent-space normal map calculated from neighbouring height samples.

The albedo and normal map are combined using ambient, directional, rim,
radial, and specular lighting to create the fixed full-screen background. The
animated `NORMAL MAPPING` bitmap lettering has separate beveled normals and a
directional light which rotates according to elapsed wall-clock time. Its
orange and cyan surfaces therefore change illumination as they move.

Full-screen material generation and shading happen once rather than on every
frame. During animation, each of the two client framebuffers restores only its
old glyph rectangles from the shaded background, then repaints the displaced
shadows and newly lit glyphs. The FPS label uses the same normal-mapped glyph
path. As in demo3, `node_x11.js` nevertheless uploads and presents the complete
framebuffer every frame, making demo4 useful for exercising the common X11
blit path with richer but still bounded per-frame JavaScript work.

The implementation uses direct `peek32`/`poke32` access with MMVM and built-in
`Buffer.readUInt32LE`/`Buffer.writeUInt32LE` access under Node.js. It uses no
image files, npm packages, X11 text operations, XShm, or native Node.js
extensions. Escape closes the demo, and the standard resolution, FPS counter,
and debug-console options are supported.

### X11 normal-mapped 3D renderer demo 5

Run the normal-mapped vehicle renderer through MMVM with:

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  node_runner.js demo5.js \
  --size 256x192 --fps 20
```

Or run the same source directly under Node.js:

```sh
node demo5.js --size 256x192 --fps 20
```

`demo5.js` preserves demo2's deterministic anti-gravity vehicle, camera view,
depth buffer, perspective-correct texture coordinates, autorotation, toolbar,
pointer, and mouse/keyboard transformations. It replaces the original five
color-only textures and one flat shade value per triangle with five generated
material sets:

- Layered graphite-blue hull composite with raised seams, grain, and rivets.
- Cold glass canopy with curved surface bands and bright structural edges.
- Ribbed machinery and propulsion-pod panels with warning markings.
- Emissive propulsion cells with a reproducible radial height profile.
- Raised coral and yellow identification chevrons.

Each material has an albedo texture, a height map, a tangent-space normal map,
specular response, and optional emission. The renderer calculates an
orthonormal tangent/bitangent/normal basis for every visible triangle. Sampled
normal-map vectors are transformed through that basis into camera space before
diffuse, rim, specular, and emissive lighting. The light direction moves using
wall-clock time independently of model rotation, and emissive propulsion
surfaces pulse using the same time source.

For MMVM performance, generated normals are quantized into a normalized
25-vector tangent-space palette. Each triangle transforms and lights those 25
vectors once, then its inner raster loop uses the sampled normal-map index to
look up brightness and additive highlights. This retains per-pixel normal-map
selection while avoiding repeated vector transforms and specular exponentiation
for every covered pixel.

The background is generated once as a packed buffer. Under MMVM it is restored
to each client framebuffer with the compatibility layer's libc-backed native
`Buffer.copy`; under Node.js the built-in `Buffer.copy` performs the equivalent
operation. Generation-stamped depth entries avoid clearing the complete
JavaScript depth array on every frame. Raw `ffi_call` use remains isolated in
`node_compat/libc.js`, and no C code or X11 extension is required.

Controls are identical to demo2: left-drag uses the selected Rotate, Move, or
Scale toolbar mode; middle-drag scales; right-drag moves; and the wheel scales
when available. A one-button mouse or ordinary single-touch touchpad can use
the toolbar followed by left-drag for all three operations. `A` or the Auto
button toggles wall-clock autorotation, `R` resets the view, keys `1`, `2`, and
`3` select the transform mode, and Escape closes the demo. Standard resolution,
FPS counter, and debug-console options are supported.

### X11 Welsh upland rally demo 6

Run the rally level through MMVM with:

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  node_runner.js demo6.js \
  --size 160x120 --fps 20
```

Or run the same source directly under Node.js:

```sh
node demo6.js --size 512x384 --fps 20
```

Startup is deliberately split across two presented frames. The program opens
the X11 window before generating the track, terrain, background, depth storage,
road geometry, or race state. Its first framebuffer contains a centred
`LOADING...` message (`LOAD` at the narrowest supported widths). Only after
that framebuffer has completed its upload does the second draw begin the
synchronous procedural build, so the X server displays the loading screen for
the complete initialization interval. Escape can close the window during this
stage; race input is ignored until initialization has completed.

The FPS counter starts with the first game frame rather than the loading frame.
Consequently the initial console sample does not include procedural build time,
and disabling both FPS display and debug logging does not break startup: the
loading draw explicitly requests the frame which triggers initialization.

`demo6.js` is an original arcade-rally game level inspired by the general feel
of late-1990s rally games rather than their assets or course designs. Its
closed three-lap stage runs through a reproducibly generated Welsh-inspired
upland landscape with a narrow muddy gravel lane, wheel ruts, puddle-darkened
patches, continuous two-course dry-stone walls, red-and-white rally posts,
rolling green fields, rain-darkened distant hills, scattered trees, sheep, and
slate-roof farm buildings beneath an overcast sky.

The initial camera is a low floating outside chase view 4.8 world units behind
and 2.15 units above the player car. Its shallow downward pitch keeps the car
large and low in the frame while showing the road, nearby fields, distant
hills, and overcast sky together. It follows the player's heading and projects
the road, terrain, walls, scenery, player, and opponents through the same
depth-buffered software 3D path. All colors, geometry, track points, terrain,
vehicles, and scenery are generated in JavaScript; there are no external game
assets, image files, npm packages, X11 drawing primitives, or XShm operations.

The player car has elapsed-time acceleration, braking and reverse, speed-based
steering grip, rolling resistance, strong grass drag, stone-wall response, and
car-to-car contact. The simulation splits each measured wall-clock interval
into stable 40 ms physics steps, so low rendering frame rates reduce visual
smoothness without slowing the race or destabilizing collision handling.

The drivetrain is an arcade-style automatic: throttle applies a continuous
torque curve from rest to the 30-world-unit speed cap, with no gear state,
clutch, shift timing, or gear-control input. On-road rolling drag is deliberately
light, while leaving the gravel or hitting a wall still removes speed sharply.
The displayed speed is scaled from world velocity and reaches roughly 186 at
the cap; actual speed through a stage depends on steering and surface contact.

Five deterministic AI competitors follow the complete closed course. Each has
a distinct speed, staggered grid position, color, and oscillating racing line;
AI target speed decreases for upcoming bends. Position is calculated from
unwrapped course progress, and the HUD reports speed, lap, and race position.
The race finishes after three laps, and `R` resets the complete player and AI
state. HUD labels automatically use compact forms at narrow resolutions.

The program starts in a rolling attract mode rather than on a stationary grid.
The player car drives itself around the complete course alongside the five AI
cars while the normal chase camera, physics timing, scenery, lap progress, and
position display continue running. A framebuffer-painted `PUSH SPACE TO PLAY`
message appears on one line at normal resolutions and on two non-overlapping
lines at narrow resolutions.

Pressing Space in attract mode atomically switches to human play and resets the
player, all five opponents, speed, grid order, lap progress, finish state,
held-key state, and frame timer. The human race therefore always starts from
the same visible staggered grid rather than inheriting the demonstration's
positions. Space also starts a new human race from the finish screen. Once a
human race is active, Space resumes its normal brake/reverse function and does
not return to attract mode.

Driving controls are:

- Up arrow or `W`: throttle.
- Space in attract mode: reset the grid and start human play.
- Down arrow, `S`, or Space during play: brake and reverse.
- Left arrow or `A`: steer left.
- Right arrow or `D`: steer right.
- `R`: restart the race.
- Escape: close the window.

Unlike the earlier pointer-oriented demos, rally controls require held-key
state. `node_x11.js` therefore selects both X11 `KeyPress` and `KeyRelease`
events and exposes matching callbacks. X11 autorepeat release/press pairs are
safe: the final state after the pair remains pressed, while the physical key's
final release clears it.

The renderer precomputes the packed sky and distant-hill background and restores
it with `Buffer.copy`. Actual depth-tested hillside meshes attach to both road
edges and extend outward in several irregular field bands. A periodic height
function creates broad folds, long ridges, and smaller undulations while
remaining continuous at the closed course seam. Trees, sheep, markers, and
farm buildings sample that same height function, so they sit on the slopes
instead of floating at road elevation.

All field cells are precomputed before the first frame. The closed course can
bring non-adjacent track sections close to a wide hillside ribbon, so every
terrain vertex queries the nearest non-local track segment. Inside that
segment's corridor, the terrain height blends downward beneath the road rather
than intersecting it. Smaller connected cells preserve the hillside surface;
no cells are simply deleted, which avoids isolated green wedges and holes. A
near-camera terrain check also prevents a cell crossing the projection plane
and expanding into a large screen-space triangle.

The renderer does have a z-buffer. Generation-stamped inverse-depth entries are
shared by the hillside, road, walls, scenery, AI cars, and player car; a pixel
is replaced only by a closer projected surface. The original hillside overlap
was therefore intersecting geometry which the z-buffer resolved correctly, not
a missing visibility test. Carving the static terrain mesh fixes the geometry
without forcing the road to draw through legitimate foreground hills.

The road is drawn as gravel, shoulder, rut, mud, wall, and scenery triangles,
while cars are assembled from depth-tested oriented boxes with separately
shaded bodies, cabins, and bumpers. This version is
primarily the visual and gameplay implementation; the terrain, renderer,
physics, and AI are kept as separate functions so their hot paths can be
optimized later without changing the level design. The requested FPS remains
a limit rather than a promise.

### Optimized software rasterizer demo 7

Run the optimized version through MMVM with:

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  node_runner.js demo7.js \
  --size 160x120 --fps 20
```

Or run the identical source directly under Node.js:

```sh
node demo7.js --size 512x384 --fps 20
```

Demo7 uses the same present-loading-then-initialize startup sequence as demo6.
The loading path does not construct its terrain, optimized road sections,
depth array, packed background, or solid-color span rows before the first
window upload.

`demo7.js` preserves demo6's course, full-resolution framebuffer, terrain,
road detail, scenery, cars, five competitors, attract mode, physics, controls,
HUD, and wall-clock-based simulation. It does not use pixel doubling, dynamic
resolution reduction, altered draw distances selected by runtime, or a
simplified MMVM-only scene. The optimized renderer remains an ordinary
depth-buffered triangle rasterizer suitable for other flat-shaded meshes.

The changes target repeated general-purpose work:

- Triangles are filled as horizontal spans. Edge and inverse-depth values are
  incremented across rows and pixels rather than recomputing three barycentric
  edge functions throughout each triangle's rectangular bounding box.
- A projected quad is rejected before triangle setup when its exact
  pixel-centre bounding box is off-screen or contains no possible sample.
- Terrain cells and road sections carry conservative horizontal bounds for a
  world-space view-frustum check. The bound includes the complete cell or
  section, so this avoids invisible transforms without clipping visible detail.
- The immutable road, ruts, shoulders, and two-course walls are built once.
  Frames traverse those reusable quads instead of allocating and calculating
  the same world vertices repeatedly.
- Projected-vertex objects are reused between frames, and the terrain loop no
  longer constructs temporary point arrays.
- Closed box meshes use a world-space normal/view test to discard back faces
  before projection. Open terrain, road, and billboard geometry is not culled.
- One inverse-depth array is cleared and reused each frame. On the tested old
  SpiderMonkey, this is faster than generation stamps because every covered
  sample performs one array lookup instead of consulting separate depth and
  stamp arrays.
- The shoulder is represented by its two visible edge bands instead of a
  full-width quad hidden beneath the road. Ruts and mud remain simple raised
  layers because splitting those narrow regions into extra triangles measured
  no faster.
- MMVM draws the player and road before terrain. This primes depth with the
  large foreground surfaces and avoids native color writes behind them. Node
  retains the more coherent background-to-front order that benchmarks best in
  V8; both orders produce the same z-buffered image.
- Ordered course distances are located with binary search rather than scanning
  all 96 track segments for every player and AI sample. This is particularly
  useful when a slow rendered frame requires several fixed physics substeps.

Framebuffer colors use packed little-endian words. `poke32` constructs one
native row for each encountered flat color. The MMVM rasterizer still evaluates
and updates inverse depth per pixel, but it combines adjacent passing pixels
into runs and copies each run with one call to the existing `NodeLibc.memmove`
wrapper. This removes repeated FFI boundary crossings without weakening depth
testing or introducing screen tiles. Stock Node.js retains its direct
`Buffer.writeUInt32LE` pixel loop, which benchmarks better under V8. The local
packed-word adapter maps individual reads and writes to `peek32`/`poke32` or
`Buffer.readUInt32LE`/`Buffer.writeUInt32LE` as appropriate.

The depth array deliberately remains JavaScript storage: a tested packed native
depth buffer was slower in js_min because each sample acquired extra
`peek32`/`poke32` boundary calls. Likewise, projected-vertex stamps, indexed
road projection, uniform scene grids, distance-sorted terrain buckets, dynamic
world-vertex pools, and separate indirectly selected span functions were all
measured and removed when their bookkeeping outweighed the work they saved.
There is no tile-level or hierarchical early-depth rejection.

The table below records the first complete five-second attract-mode interval
from otherwise identical 12-second runs. The FPS limit was set to 120 so it did
not cap MMVM. These are comparative measurements from the development machine,
not portable guarantees; camera position and scheduler load can move an
individual result slightly.

| Runtime and framebuffer | demo6 | demo7 | Change |
| --- | ---: | ---: | ---: |
| `js_min.exe`, 160x120 | 4.3 FPS | 10.6 FPS | 2.47x |
| `js_min.exe`, 256x192 | 2.5 FPS | 7.4 FPS | 2.96x |
| Node.js 24, 512x384 | 20.3 FPS | 59.8 FPS | 2.95x |

The optimized js_min renderer also measured 6.0 FPS at 320x240. A longer
25-second 640x480 run reported 2.4, 2.1, and 2.2 FPS in consecutive intervals.
Native 640x480 therefore remains expensive; demo7 intentionally does not
conceal that limitation with upscaling. Node.js reaches the shared X11 layer's
roughly 60 Hz animation-frame scheduling ceiling at 512x384, so the
optimization does not exchange Node performance for MMVM performance.

### MMVM-specific demo 8

Demo 8 is the demo7 rally refactored and optimized specifically for
`js_min.exe`. It has a two-file boundary:

- `demo8_runner.js` owns the shell lifecycle, libc wrappers, timers and poll
  event loop, native memory, X11 framebuffer, common option and font helpers,
  and the small generated-code API.
- `demo8.js` owns the rally simulation and renderer and registers its entry
  point with `DemoRunner.define`.

The runner loads the application named by its first argument, so run it
without `node_runner.js` as follows:

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  demo8_runner.js demo8.js --size 320x240 --fps 20
```

The default remains 256x192 at 20 FPS. `--size WIDTHxHEIGHT`, separate
`--width` and `--height` options, and `--fps` continue to work; valid sizes are
64..1024 pixels in each dimension and valid frame limits are 1..120 FPS.
`--[no-]fps-counter` controls the on-screen counter and
`--[no-]debug-events` controls console event and five-second FPS logging.
`--dump-native-assembly` prints the macro-assembler calls emitted for the
first source-compiled triangle-rasterizer specialization, including its
specialized colour key and resulting machine-code byte count. The listing is
also retained as `variant.macroAssembly` on every compiled variant. For
example:

```sh
LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  demo8_runner.js demo8.js --size 64x64 --dump-native-assembly
```

Escape pauses demo8 and opens its mode menu. The menu keys are:

- Escape resumes the current mode without resetting it. Pressing Escape twice
  therefore acts as pause/resume.
- `R` selects **Restart Game**: it resets the race grid, lap/position state,
  and player/AI vehicles, then returns to rolling attract mode with the
  `PUSH SPACE TO PLAY` prompt. Space resets the grid again and starts the
  human-controlled rally.
- `G` enters the garage view.
- `F` enters free driving on the bounded muddy field.
- `Q` exits demo8.

The garage camera automatically travels around the rally car on an elliptical
path and follows a sinusoidal up/down motion. Hold mouse button 1 and drag to
control its orbit angle and height; release the button to resume automatic
motion. The detailed car used here and in free-driving mode is a boxy 1970s
two-door rally saloon with a four-seat-sized cabin: long wheelbase, distinct
bonnet and boot, one long outlined door and handle per side, and fixed rear
quarter windows rather than rear doors. It also has four low-polygon tyres with
metal hubs. Their tread is 0.11 simulation units wide against a 0.64-unit
diameter: half the previous width and approximately 69 percent narrower than the
original tyres. All four wheel centres use the same +/-0.80 lateral position,
placing their straight-ahead outer faces at approximately +/-0.855 against the
+/-0.84 body sides. The lower body is a purpose-built shell rather than a solid
box: its side-panel triangles follow four segmented semicircular wheel openings,
with no body triangles spanning those openings. Recessed dark liners run inward
from the cut edges, so the arches are part of the main body rather than separate
pieces floating outside it. Front steering remains visible naturally when the
car yaws relative to the travel-facing camera. The model has rectangular
unlit front and rear lamp lenses, a dark grille, bright period-style bumpers,
sloped front and rear glass, body-coloured external frames and pillars, and a
highlighted painted-metal roof. The side-window sills follow the wider body line
while the upper glass and pillar vertices taper inward to meet the roof; the
glazed cabin does not splay outward. The lightweight race and AI car
representation is retained outside the garage and free-driving mode.

Free-driving mode uses the normal arrow/WASD automatic-style driving controls,
but replaces the rally course and competitors with a fixed 200-by-160-unit
field, over five times the area of the original 90-by-68 field. Its surface is
a clearly alternating dark/light brown checkerboard of 20-unit squares, with
puddles and visible posts at the outer field boundary. The outer perimeter is
colliding: limits account for the saloon's rotated width and length, keeping its
body, wheels, and bumpers inside the checkerboard at sides and corners. Contact
removes only velocity directed out of the field, so a glancing car can scrape
along an edge, sustained throttle into it settles without bouncing through it,
and reverse can pull the car away. Two pale painted lines trace a coarse version
of the reproducible rally-course shape at +/-4.5 units from its centre, and a
stripe marks its start. The car resets on that stripe, aligned with the course
tangent. These internal markings are paint only: they have no collision, grip,
steering, or speed effect, and the car may cross them to free drive over the rest
of the checkerboard. Above the field is a horizontally wrapping cloudy grey
skybox texture. It is generated deterministically at initialization from four
octaves of wrapping value noise into a 512x64 native-memory panorama; no bitmap
file is required or checked in. Camera heading selects the panoramic longitude,
horizontal field of view determines the sampled span, and the texture is scaled
vertically to the pitched ground-plane horizon.

The source texture takes about 1.9-2.0 seconds to synthesize under
`js_min.exe` at 320x240, compared with about 10.9 seconds for the discarded
2048x128 version. `freeDriveSkyboxBlitJS` is compiled through the runner's
NativeCompiler and expands the wrapped texture into the visible sky in one
native call per frame. A 320x240 A/B measurement produced about 14.4-15.1 FPS
with the sky and 14.8-15.0 FPS with the draw call disabled, so the new pass has
no measurable impact on the existing free-drive ceiling. The generated blitter
is included in `--dump-native-assembly` output; it is not hand-written machine
code.

The fourth octave and anisotropy-compensated noise cell shapes add compact,
roughly square high-frequency billows, preventing the projected panorama from
reading as long horizontal wisps. The same native-memory texture is reflected
by every windscreen, rear window, door window, and fixed quarter window in both
free-drive and garage modes. A view vector and the transformed pane normal
produce reflection coordinates at each of the four vertices. Each pane is then
drawn as two properly texture-mapped triangles: `u/z`, `v/z`, and `1/z` are
interpolated per pixel for perspective correction, the shared depth buffer is
tested and updated, and the resulting integer coordinates select a texel using
nearest-neighbour sampling. Downward reflection rays are mirrored at the
horizon because this environment texture contains a sky hemisphere rather than
a ground texture.

The hot edge, depth, perspective-division, wrapping, and texture-sampling loop
is the checked-in `windowTextureTriangleJS` function compiled by NativeCompiler;
it is not hand-written machine code. The whole detailed car needs 12 textured
triangles for its six panes. At 320x240, representative measurements were about
14.1-14.4 FPS in free drive and 13.3-13.6 FPS as the garage camera orbited.

The subsequent 0.24 model-submission pass preserves those textures and visible
geometry but rejects coherent hidden pieces in car-local space before doing
projection or raster setup. Since the camera stays above the opaque car, the
floor is omitted; only the near body side and end, corresponding glass and
trim, and appropriate end lamps and bumper are submitted. The open arches can
expose three wheels at an oblique angle, so only the far diagonal wheel is
rejected. The near-side wheels retain sidewalls and hubs, while the exposed
far-side wheel contributes its tread but not its outward-facing side disc.

Wheel-circle trigonometry is precomputed at initialization. Shared segment
vertices are transformed once into preallocated scratch rings, rather than
transforming both endpoints again for every segment and allocating temporary
objects each frame; opaque tread quads also use back-face rejection. A wheel
therefore performs 29 rather than 50 point transformations. With the 20 FPS
limit at 320x240, representative `js_min.exe` free-drive samples rose to about
19.3-19.4 FPS and the on-screen counter reached 20 FPS. Representative garage
views rose to approximately 18 FPS. These measurements include the full-screen
blit and the proper nearest-neighbour window reflections.

Free drive uses the same detailed 1970s saloon as the garage. Its
front tyres, sidewalls, and hubs yaw around their own vertical centres in
response to left/right input, easing back to straight ahead after release.
Steering lock is approximately +/-35.5 degrees with equal front and rear track;
the rear wheels remain aligned with the body while the front tyres yaw about
their centres. Rally mode retains the lightweight car geometry for the player
and five AI competitors. The free-drive camera follows
a smoothed recent direction of travel rather than being rigidly locked to the
body heading. The saloon therefore visibly yaws relative to the camera when
steering, and the camera retains the last travel direction while the car is
stationary. Its smoothing uses wall-clock elapsed time and is independent of the
achieved frame rate.

Free drive uses separate world-space velocity, inertial yaw, and a two-axle
tyre model. Front- and rear-axle lateral slip generate separate tyre forces and
yaw torque. Turning the wheels while stopped therefore does not rotate the car;
steering only produces force once it is moving, and reverse steering acts in
the opposite direction. Holding Space, Down, or S from low speed supplies
continuous reverse torque; reverse is limited to 14 simulation units compared
with 30 forwards and retains a practical turning arc without permitting
rotation in place. The same computed lateral acceleration drives the saloon's
body-roll target, so faster, harder turns and power slides lean the sprung body
farther than low-speed manoeuvres. A damped suspension spring smooths both
weight transfer and return to level. The body shell, windows, trim, lights, and
bumpers rotate together around a low longitudinal axis, independently of the
upright wheels; normal roll is limited to about +/-6.9 degrees with an
+/-8-degree safety bound.

The saloon is rear-wheel drive. To initiate a powerslide, accelerate, begin the
turn, briefly release the throttle, tap Space, Down, or S, release the brake,
and reapply throttle. Forward braking transfers load away from the rear axle,
temporarily reducing its lateral grip so front tyre force can kick the rear
out. Once rear slip exists, engine force at the driven rear axle consumes part
of the same finite traction budget that provides lateral grip; power can
therefore sustain the slide after the brake is released. Countersteer controls
the front lateral force and arrests excessive yaw. Reduce or release throttle
to let rear grip recover and settle the car. A sufficiently aggressive
full-throttle turn may also produce power oversteer without a brake tap.

`POWER SLIDE` is based on measured lateral velocity and yaw rate, not held keys,
and uses hysteresis so it does not flicker at the threshold. With
`--debug-events`, physical slide start and end are also written to the console.
Reverse steering does not engage the powerslide state.

Demo8 text remains the built-in 5x7 bitmap font painted directly into the
framebuffer. Its integer pixel scale is proportional to the viewport: 320x240
is the 2x baseline, 160x120 and smaller displays use the native 1x glyph, and
larger displays choose the nearest corresponding integral scale. There is no
font interpolation, antialiasing, X11 text call, or external font renderer.
HUD placement, menu dimensions, loading text, garage labels, and the FPS
counter all use the same scaled glyph and line metrics.

Press F2 while demo8 is running to cycle triangle-half rasterization through
three independently selectable implementations:

1. the default native i386 generated by compiling `triangleHalfRasterizerJS`
   itself;
2. the same function interpreted as ordinary JavaScript; and
3. the existing hand-written macro-assembled i386 routine.

Each change is reported on stdout as `hand ASM`, `compiled native`, or
`JS reference`. The JavaScript function deliberately follows the hand-written
routine's packed arguments, signed 32-bit fixed-point edge state, clipping,
reciprocal-depth interpolation, signed depth test, and native framebuffer
layout. The hand-written assembler implementation remains available and has
not been rewritten, so its performance and output can be compared directly
with the compiler.

The compiled implementation is created by the following real source-compiler
call in `demo8.js`:

```js
triangleHalfRasterizerASM = compileNative(triangleHalfRasterizerJS).fn;
```

`compileNative` calls the function's `toString()` method, tokenizes and parses
that text, lowers its syntax tree to i386, maps the generated bytes writable,
and changes the mapping to read/execute before making it callable. It does not
select a pre-written routine based on the function name or fall back to the
hand-written assembler. The returned compilation object contains the callable
`.fn`, original `.source`, parsed `.ast`, generated `.variants`, and a
`.destroy()` method. The callable also exposes its owner as
`.compiledObject`.

The deliberately small compiler subset supports function parameters and
function-wide `var` locals, integer literals, blocks, `while`, `if`/`else`,
assignment and `+=`/`-=`, postfix increment/decrement, unary `+`, `-`, and `~`,
signed comparisons in conditions, integer arithmetic, shifts, and bitwise
operators. Direct `peek32(address)` and `poke32(address, value)` calls lower to
native memory loads and stores. Free identifiers and member expressions may be
bound to integer constants through `function.nativeCompile.constants`.
Parameters beyond the eight arguments supported by MMVM's FFI bridge must be
listed in `function.nativeCompile.specialize`; a native variant is generated
and cached for each observed tuple of specialized values. Demo8 uses this for
the ninth, packed-colour argument.

At startup, a small edge-swapped and horizontally clipped triangle half is run
through all three implementations. Demo8 compares every affected packed pixel
and signed fixed-point depth word and stops with an error if any result differs.
At 320x240 with the 20 FPS limit, recent five-second samples measured 19.6--20.1
FPS for hand ASM, 18.6--19.4 FPS for compiled native after switching modes, and
4.5--5.2 FPS for interpreted JavaScript. With the cap raised to 60, hand ASM
measured 21.5--23.3 FPS and compiled native measured 21.1--23.7 FPS. These are
comparative measurements from the development machine, not portable
guarantees.

`demo8_x11_test.js` is a JavaScript-only X11 test driver for repeatable runtime
switching. It has its own minimal X11 wire bindings, finds the demo by its
`WM_NAME`, queries the server's F2 keycode, and sends core key events. It uses
only the built-in `fs` and `net` APIs and works through both Node.js and the
compatibility runner. Start demo8 in one terminal, then run either:

```sh
node demo8_x11_test.js --count 3 --delay 1000

LD_LIBRARY_PATH="$MOZJS_LIB" \
  "$MMVM_ROOT/artifacts/js_min.exe" \
  node_runner.js demo8_x11_test.js --count 3 --delay 1000
```

The default three events make one complete compiled native -> JavaScript
reference -> hand ASM -> compiled native cycle. `--count`, `--delay`, `--title`,
and `--depth` control the number and spacing of F2 presses, the target window
name, and maximum X11 tree-search depth. The driver currently supports local
Unix displays; `/tmp/.X11-unix/XN` is the standard X11 Unix-domain socket
location.

The optimized rasterizer keeps its depth and framebuffer data in native
memory. It submits complete triangle halves to compact i386 routines and uses
a generated native bitmap-text blitter for repeated HUD strings. The retained
hand-written span, triangle, and text routines use the runner's JavaScript
macro assembler: named registers, operations, labels, and conditional branches.
They contain no raw opcode arrays or byte-offset patches. Instruction encoding
and branch fixups live behind `nativeCode.compile` in `demo8_runner.js`; the new
source compiler emits through the same assembler boundary.

Writable mappings are changed to read/execute before being called (W^X); they
are never simultaneously writable and executable. Shared projected vertices,
coarser render-only terrain and road meshes, and distance detail levels reduce
old-SpiderMonkey object and call overhead while the 96-point physics course
remains unchanged. The runner API keeps the MMVM, macro assembler, and X11
mechanisms separate from the game so it can become a general demo runner
later.

Triangles crossing the camera near plane are geometrically clipped rather
than dropped. Hillside vertices are carved against the nearest point anywhere
on the complete road, and terrain-band widths are bounded by the carve radius;
this prevents coarse terrain cells on tight bends from bridging over the road.

This implementation is intentionally not Node.js-compatible. It assumes the
32-bit x86 Linux `js_min.exe` environment used throughout this repository.
For the final macro-assembled build, consecutive five-second attract-mode
samples at 320x240 with a 20 FPS limit measured 20.0, 19.7, 19.9, 19.8, and
19.8 FPS on the development machine. With the limit raised to 60 to expose
rendering headroom, it measured 24.0, 22.0, and 25.1 FPS. These measurements
are a working target, not a portable performance guarantee.

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
interfaces. Native compatibility buffers implement `copy` using libc `memmove`,
which also avoids JavaScript byte loops when framebuffer demos restore a
precomputed packed image.

See [NODE_COMPAT_PLAN.md](NODE_COMPAT_PLAN.md) for the original architecture,
constraints, and acceptance criteria.
