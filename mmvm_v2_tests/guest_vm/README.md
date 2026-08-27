# Guest VM bootstrap

This directory contains the interpreter-first JavaScript guest VM described in
[`../GUEST_VM_PLAN.md`](../GUEST_VM_PLAN.md). It is intentionally a bootstrap,
not yet a complete ECMAScript 5.1 implementation. ECMAScript 5.1 is the fixed
guest-language target; the currently implemented
language and Buffer features are always exercised by checked-in tests under
both Node.js and `js_min.exe`.

Guest garbage collection is automatic at allocation-triggered interpreter safe
points. `VM.collect()` remains available for deterministic tests and explicit
memory-pressure handling, but applications do not need to call it.

`guest_runner.js` enables the opt-in raw-FFI compatibility binding so the
existing unchanged `hello.js` example works. Direct embedders are FFI-disabled
by default; see the embedding guide before enabling that trusted capability.

Read these documents before changing or embedding the VM:

- [`DESIGN.md`](DESIGN.md) defines the architecture, internal representations,
  invariants, bytecode ABI, collector, Buffer ownership, and extension rules.
- [`EMBEDDING.md`](EMBEDDING.md) documents the public bootstrap API, host loading,
  native functions, explicit roots, execution, errors, and shutdown.
- [`LINEAR_HEAP.md`](LINEAR_HEAP.md) defines the mandatory runtime-owned heap,
  record layouts, accessor boundary, and host-independent memory model.
- [`../GUEST_VM_PLAN.md`](../GUEST_VM_PLAN.md) records the intended route from
  this bootstrap to a conforming ES5.1 interpreter and later optional kernel AOT.

The primary embedder model is `JSRuntime` -> `JSContext` -> resumable
`Execution`. An execution yields on finite budget exhaustion and before every
external host call. The legacy `VM` facade retains one default context and
auto-services host callbacks for existing tests and examples.

Load the complete VM into the minimal shell with one call:

```js
load("guest_vm/guest_vm.js");
```

The bootstrap owns all internal module ordering. Node code can use the same
entry point with `require("./guest_vm/guest_vm.js")`; direct `vm.js` requires
remain compatible.

Run the complete current suite with either host or both:

```sh
guest_vm/tests/run_tests.sh node
guest_vm/tests/run_tests.sh js_min
guest_vm/tests/run_tests.sh both
```

The runner accepts `NODE_BINARY`, `JS_MIN_BINARY`, and `FIREFOX_LIB_DIR`
environment overrides. It derives its default paths from the repository layout
and contains no machine-specific absolute paths.

Run one guest program directly with:

```sh
node guest_runner.js guest_vm/tests/language/for_loop.js

LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js guest_vm/tests/language/for_loop.js
```

The exact relative paths in the second example assume the current working
directory is `mmvm_v2_tests` and the Firefox and MMVM directories are siblings
of the repository containing it.

The unchanged libc-only HTTP server is now an end-to-end guest-VM integration
target. Prepare the ignored, temporary document root and run it with:

```sh
mkdir -p artifacts/www

LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js net.js --directory artifacts/www 8000
```

It listens on all interfaces by default, matching `python3 -m http.server`.
Add `--bind 127.0.0.1` to restrict it to localhost. Program arguments after
`net.js` become the guest's top-level `arguments` object. `artifacts/www/` is
ignored by Git and remains a disposable test directory; do not commit its
contents.

The unchanged Node-compatible server also runs through the guest interpreter.
Unlike `net.js`, it does not make raw FFI calls itself. `guest_runner.js`
installs an embedder-side subset of Node's `require`, `process`, `console`,
`Buffer`, `Date`, `http`, and `fs` APIs, then services the resulting host-call
yields with the existing libc-backed, nonblocking poll loop:

```sh
mkdir -p artifacts/www

LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js node_web.js \
  --bind 127.0.0.1 --directory artifacts/www 8000
```

Omit `--bind 127.0.0.1` to listen on all IPv4 interfaces. The port,
`--bind`/`-b`, and `--directory`/`-d` behavior belongs to unchanged
`node_web.js` and matches its direct Node.js invocation. The filesystem calls
are asynchronous guest callbacks; the socket is nonblocking and driven by
`poll(2)`. Binary files remain guest `Buffer` values and are copied to the
native output queue without string conversion.

The guest Node environment is deliberately a narrow embedding profile, not a
claim that the VM already implements Node.js. At this checkpoint `require`
accepts the built-in names `http`, `fs`, and `net`, plus relative JavaScript
modules. The rest of Node's standard library remains future work. Run
`node_web.js` directly with Node.js when testing the unchanged source against
real Node.

## X11 framebuffer demos through the guest VM

The guest VM can run the unchanged `demo1.js` through `demo7.js`. Their relative
dependencies, `demo_common.js` and `node_x11.js`, execute as guest CommonJS
modules in their own `JSContext` instances. Only the Node built-ins, timers,
and the explicitly documented native-memory intrinsics cross into the
embedder; the X11 wire protocol, framebuffer drawing, bitmap font, simulation,
and rasterizers remain guest JavaScript.

Run it from `mmvm_v2_tests` with the existing local X display environment:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js demo1.js --size 64x64 --fps 5
```

The identical guest module graph can be hosted by Node.js:

```sh
node guest_runner.js demo1.js --size 64x64 --fps 5
```

Every later demo uses the same command form. For example, the optimized rally
renderer is:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js demo7.js --size 160x120 --fps 20

node guest_runner.js --vm-threaded demo7.js --size 160x120 --fps 20
```

Demo8 is the deliberately MMVM-specific standalone rally build. It takes two
guest source files and cannot run with a Node host:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js demo8_runner.js demo8.js --size 320x240 --fps 20
```

The guest `load()` binding is available on the MMVM host and evaluates the
second file in the same guest global environment. The demo retains its normal
resolution, FPS, menu, and rasterizer-selection options.

The covered progression is demo1's bitmap framebuffer UI; demo2's software 3D
renderer; demo3's full-frame blit; demo4's procedural normal mapping; demo5's
normal-mapped 3D renderer; and the demo6/demo7 rally game. In particular, the
rally demos exercise `Math.PI`, track generation, loading-to-attract-mode
transition, depth-buffered road/hillside/car drawing, and packed native output.
The language suite checks the ES5.1 Math constants and methods used during
track construction. A live X11 smoke test remains necessary to verify the
framebuffer rather than just compilation. Demo8 additionally exercises guest
function source recovery for its JavaScript macro compiler.

This is not direct Node execution: `guest_runner.js` still tokenizes and
compiles every application module into guest execution. The embedder selects
built-in `fs`, `net`, `http`, timers, and process streams under Node, while
`js_min.exe` selects the libc-backed compatibility versions. `js_min.exe`
enables the structured compiled tier by default; pass `--vm-threaded` when a
Node-hosted guest should exercise that same tier.

The in-progress kernel-native interpreter is selected explicitly with
`guest_runner.js --vm-native program.js`. Its portable dispatch benchmark and
the current migration boundary are documented in `PERFORMANCE.md`.

The demos retain their normal resolution and FPS options. Correctness coverage
does not imply that the guest currently meets each requested frame cap:
demo6/demo7 are substantially heavier than demo1--demo5. No artifacts
directory or generated framebuffer image is required or stored in
`mmvm_v2_tests`.

Current benchmark commands, measured demo2 progress, and the optional
`guest_runner.js --vm-profile` opcode profiler are documented in
`PERFORMANCE.md`.

### Runtime introspection

Embedders can inspect authoritative state without reading linear-memory offsets
or relying on host-side handles:

```js
var record = vm.inspectHeapRecord(guestAddress);
var snapshot = vm.inspectExecution(execution);
```

`inspectHeapRecord` reports the record type, allocation size, GC state, and the
named fields relevant to frames, programs, and functions. `inspectExecution`
returns the current guest call stack (top frame first), including each frame's
program, filename, PC, numeric opcode, environment, caller, and register count;
when the native engine is enabled its `nativeEngine` field also reports native
runs, bytecodes, and semantic exits. These objects are read-only diagnostic snapshots allocated on
the host. They are not guest values and changing them never changes VM state.
The VM continues to access all authoritative fields through `HeapRecords`.

The embedder provides on both hosts:

- synchronous `fs.readFileSync` for Xauthority data;
- Unix-domain `net.createConnection` with nonblocking socket events;
- byte-accurate Buffer slicing, copying, integer access, and ASCII conversion;
- zero-copy native guest Buffer writes to the host socket queue when possible;
- `setTimeout`, `clearTimeout`, and `requestAnimationFrame` scheduling;
- `process.env.DISPLAY`, `XAUTHORITY`, and `HOME`.

Guest Buffer storage does not become a host Node Buffer. Under Node, the same
guest Buffer implementation uses the array-backed memory adapter in
`host_memory.js`; its byte and 32-bit operations are the portable equivalent of
the `peek8`/`poke8`/`peek32`/`poke32` native-memory operations. Consequently
`demo1.js` sees no native pixel address under Node and correctly uses
`Buffer.writeUInt32LE`. Under `js_min.exe`, native backing exposes a pointer and
the unchanged demo may use `poke32`. Direct arbitrary-address FFI remains
intentionally unavailable to a Node-hosted guest.

The X11 socket remains the standardized local path selected by `DISPLAY`, such
as `/tmp/.X11-unix/X1`; `node_x11.js` derives the display number rather than
depending on a machine-specific absolute socket name.

## Three-context multiplexing demo

`demos/three_contexts.js` creates one `JSRuntime` containing `cx_a`, `cx_b`, and
`cx_c`. The first two contexts run infinite guest loops which yield `c_call`
host requests. A round-robin embedder routes each request into the real guest
`c_call` function in `cx_c`. After printing 100 alternating calls, `cx_c`
requests shutdown, returns from `c_call`, and the embedder aborts both producer
continuations.

Run it under Node with no dependencies:

```sh
node guest_vm/demos/three_contexts.js
```

Or run the same file directly under `js_min.exe`:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_vm/demos/three_contexts.js
```

The output is deterministic and starts like this:

```text
[embedder] starting round-robin execution of cx_a and cx_b
[cx_c] hi from cx_a | call 1/100
[cx_c] hi from cx_b | call 2/100
```

It ends only after `cx_c` has processed call 100, requested shutdown, and
returned from that invocation.
