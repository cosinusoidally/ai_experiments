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

## X11 framebuffer demo through the guest VM

The guest VM can run unchanged `demo1.js`. Its relative dependencies,
`demo_common.js` and `node_x11.js`, execute as guest CommonJS modules in their
own `JSContext` instances. Only the Node built-ins and timers cross into the
embedder; the X11 wire protocol, framebuffer drawing, bitmap font, and event
handling remain interpreted guest JavaScript.

Run it from `mmvm_v2_tests` with the existing local X display environment:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js demo1.js --size 64x64 --fps 5
```

The default `256x192` resolution and `20` FPS limit are also accepted. The
current interpreter is functionally correct on this path but is not yet fast:
the pixel-at-a-time demo measured roughly 0.2–0.4 FPS at 64×64 during this
checkpoint. This is an interpreter-performance limitation, not X11 blocking or
a frame-timing change. No artifacts directory or generated framebuffer image
is required or stored in `mmvm_v2_tests`.

The embedder provides:

- synchronous `fs.readFileSync` for Xauthority data;
- Unix-domain `net.createConnection` with nonblocking socket events;
- byte-accurate Buffer slicing, copying, integer access, and ASCII conversion;
- zero-copy native guest Buffer writes to the host socket queue when possible;
- `setTimeout`, `clearTimeout`, and `requestAnimationFrame` scheduling;
- `process.env.DISPLAY`, `XAUTHORITY`, and `HOME`.

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
