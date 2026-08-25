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
