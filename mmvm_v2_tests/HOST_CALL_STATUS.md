# Standalone guest VM dependency status

This file is the living work ledger for removing JavaScript-host dependencies
from the guest VM.  It records what runs in the standalone `js_runner` image,
which native semantic gaps still prevent a workload from running there, and
which external services are intentional guest-owned libc/FFI operations rather
than calls back into `js_min.exe`.

The source trees under `../../js_tests` are read-only inputs.  Generated
snapshots, logs, executables, and temporary web roots belong in the ignored
`artifacts/` directory and are never checked in.

## How to audit the host boundary

The hosted runner accepts `--vm-log-host-calls`.  With `--vm-native`, it logs
both places where the native interpreter returns to the JavaScript semantic
engine and actual callbacks into an embedder:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_runner.js \
  --vm-native --vm-profile --vm-log-host-calls program.js
```

The transition names have precise meanings:

- `native-fallback-call` and `native-fallback-construct`: the native bytecode
  engine could not complete the operation and returned to the JavaScript
  semantic engine;
- `embedder-call` and `embedder-construct`: execution is about to yield an
  externally registered callback to the command runner.

The log includes the guest filename, line and column plus receiver and argument
types.  It intentionally omits argument values.  An operation can produce both
lines when native execution falls back and the semantic implementation then
discovers an embedder callback.

The standalone image has no host JavaScript interpreter to log.  It performs
supported language operations, parsing, compilation, heap/GC work, filesystem
loading, libc FFI, timers, sockets, and X11 traffic itself.  A remaining
semantic gap terminates with an opcode, bytecode PC, and named diagnostic
reason.  A crash instead of that diagnostic is a runtime defect.

`--vm-no-host-calls` remains the strict enforcement mode for a hosted run.  It
and the logging mode answer different questions: enforcement rejects actual
embedder callbacks, while logging also exposes native semantic fallbacks that a
standalone image cannot service.

## Audit baseline: 2026-09-28

Baseline revision before the audit changes: `2e52849`.  The audit used a fresh
generic standalone image generated from the working tree and a 32-bit
`js_runner.exe`.  No program source or environment was embedded in the image.

During this audit the common standalone Octane failure at
`new Date() - start` was fixed in the general native `ToNumber` path.  Date
objects now use their guest-heap numeric slot when the visible `valueOf` method
is still the built-in Date intrinsic; an overridden method returns to the
semantic engine.  This removed the same `SUBTRACT` failure from every suite
rather than adding benchmark-specific behavior.

### Core and language tests

- The complete Node/reference VM suite passes: 12 guest programs, 266 guest
  assertions, plus tokenizer, heap, GC, embedding, compiler, and isolation
  tests.
- Direct standalone guest language files passing: `arithmetic.js`,
  `compiled_stability.js`, `declaration_hoisting.js`, `for_loop.js`,
  `object_control.js`, `try_update.js`, and `unicode_identifiers.js`.
- `closure_fallback.js` reaches its explicit `guestCollect()` call, which has
  no standalone intrinsic yet. The preceding closure/environment assertions
  pass in the hosted audit.
- `functions_objects.js` reaches `Function.prototype.bind`; bind and invocation
  of the resulting bound function currently require semantic fallback.
- `standard_library.js` first stops at the non-native `isFinite` implementation.
  Its hosted trace also inventories the later fallback-only ES5 operations:
  dynamic `Function`, eval, Error constructors/formatting, `escape`, JSON,
  `Array.forEach`/sort, `String.trim`, `Object.keys`, and several Math methods.
- `typed_arrays.js` constructs the initial `Uint8Array`, but its first semantic
  mismatch is `bytes.byteLength === undefined` instead of `4`.
- `buffer_guest.js` first stops at the non-native `Buffer.isBuffer` call.
- `guest_vm/tests/run_tests.js` is an embedder test driver, not just an ES5.1
  guest program.  Running that driver verbatim in the standalone image first
  encounters its bootstrap `read` dependency; after that, a standalone version
  would need a guest-owned embedding/introspection API capable of constructing
  nested runtimes and contexts.  The language files above are the relevant
  standalone conformance payloads.  The host implementation tests remain a
  hosted regression gate.

Outstanding general work exposed by this group:

- make explicit collection a guest/native operation, rather than a callback to
  the hosted runtime;
- implement bound-function creation and invocation in guest heap records;
- implement the fallback-only ES5 standard-library functions above as
  guest/native semantics, starting with `isFinite`;
- populate typed-array `byteLength` and complete the remaining typed-array
  constructor/view operations;
- implement `Buffer.isBuffer` and then complete any subsequently exposed
  Buffer call paths;
- provide a guest-owned runtime/context/introspection surface if the embedder
  API test driver itself is required to run recursively inside `js_runner`.

### Integration programs

- `hello.js` passes in the standalone image.
- `net.js` serves a real binary-safe HTTP response over a localhost socket.
  The audit fetched a temporary file and received HTTP 200.  This proves the
  standalone libc socket, poll, filesystem, and Buffer path does not require a
  JavaScript-host callback.
- `node_web.js` reaches its listening state, but the first HTTP request stops
  at the fallback-only `decodeURIComponent`. A complete hosted request then
  uses `fs.stat`, `Stats.isDirectory`, async `fs.readFile`,
  `String.toLowerCase`, `ServerResponse.writeHead`/`end`, and `console.log`.
  These Node-compat services must be backed by guest-owned libc/poll state and
  resumable guest callbacks in the standalone image. Socket creation itself is
  already guest-owned and working.
- Demos 1 through 5 create their X11 window and enter the render loop in the
  standalone image.  Demos 6 and 7 load the course and reach attract mode.
  Demo8 initializes its procedural sky, renderer, native rasterizer, and attract
  mode.  These are startup/render-loop smoke tests; garage, menu, and free-drive
  interaction remain manual behavioral coverage rather than a host-dependency
  gap.

Outstanding general work exposed by this group:

- implement native `decodeURIComponent`, then move the listed asynchronous
  filesystem, request/response, logging, and callback paths into the guest
  Node-compat layer;
- retain a manual demo8 garage/free-drive regression pass because automated
  startup alone cannot exercise those state transitions.

### Test262

- The current standalone runner loads and compiles `test262_runner.js`, but a
  chapter-6 run stops at `require("fs")` before producing conformance counts.
- A hosted one-file chapter-6 audit passes and shows the remaining bootstrap
  boundary explicitly: `require`, `load`, `fs.readFileSync`, and
  `Test262VM.runVariant` are embedder calls. Console output is also an embedder
  call in hosted mode. Dynamic `Function` and Error construction are semantic
  fallbacks but do not themselves require an external service.
- The authoritative conformance history remains in `TEST262_STATUS.md`; there
  are no accepted skips.  This audit does not replace those pass/fail/not-run
  totals with a partial result.

Outstanding general work exposed by this group:

- provide a guest-native `require("fs")` binding and synchronous source reads;
  standalone `load` itself is already used successfully by Octane;
- implement `Test262VM.runVariant` on the guest-owned runtime/context API so it
  creates a cheap fresh `JSContext`, evaluates the harness/test, reports its
  structured result, and tears the context down without an embedder callback;
- once bootstrap completes, run all 3,292 authored ES5.1 files to completion
  and record pass/fail/not-run counts in `TEST262_STATUS.md`;
- keep context teardown reclaiming per-test state so the full run does not
  reproduce the previously observed long-run heap growth.

### Octane 2.0 quick correctness

All suites were invoked through the same generic standalone image.  `passed`
means Octane's own quick correctness validator accepted the result; it is not
an Octane performance score.

- Passed: Richards (0.75 s, 38,784 KiB peak RSS).
- Passed: DeltaBlue (0.97 s, 40,960 KiB).
- Passed: Crypto (2.68 s, 50,176 KiB).
- Passed: RayTrace (1.30 s, 69,504 KiB).
- Passed: Splay and SplayLatency (2.42 s, 208,896 KiB).
- Passed: NavierStokes (1.50 s, 43,520 KiB).
- Failed: EarleyBoyer, native `GET_PROPERTY_CONST` gap (6.93 s,
  76,672 KiB).
- Failed: PdfJS, native `CALL` gap (28.20 s, 212,352 KiB).
- Failed: Gameboy, native `CALL` gap (8.95 s, 105,088 KiB).
- Failed: CodeLoad, native `CALL` gap (1.03 s, 38,528 KiB).
- Failed: zlib, native `GET_GLOBAL` gap after entering the benchmark
  (17.18 s, 111,488 KiB).
- Failed: Typescript, native constructor gap while loading/running the suite
  (28.06 s, 211,072 KiB).
- Crashed: Box2D terminates with SIGSEGV after 7.71 s.  This is a standalone
  correctness/stability blocker and must be debugged before semantic work on
  that suite can be trusted.
- Pathological/not completed: RegExp and Mandreel did not finish their quick
  correctness run within a useful audit interval.  Regex optimization is not a
  current goal, but the functional subset used by other suites must remain
  correct.  Mandreel requires separate profiling to distinguish compilation,
  heap growth/GC, and execution cost.

Outstanding general work exposed by this group, in priority order:

1. Diagnose and remove the Box2D native crash; all unsupported operations must
   return a structured diagnostic, never corrupt state or segfault.
2. Complete general native CALL and CONSTRUCT handling.  This is shared by the
   language suite, Test262 bootstrap, `node_web.js`, PdfJS, Gameboy, CodeLoad,
   Typescript, and Buffer/typed-array coverage.
3. Complete ordinary object constant-property lookup and global resolution for
   the object layouts exercised by EarleyBoyer and zlib.
4. Profile and fix Mandreel's large startup/execution cost through general
   parser, compiler, heap, GC, and dispatch improvements.
5. Implement the correct regex subset needed by dependent programs; defer a
   specialized high-performance regex engine and the standalone RegExp score.
6. After correctness, run stock (non-quick) Octane via `js_runner`, record
   scores, and optimize only general VM mechanisms.

## Completion criteria

This ledger can be closed only when all of the following are true:

- the hosted audit of the existing tests, integrations, demos, and supported
  Octane suites contains only explicitly documented embedder services;
- the same programs run through a generic `js_runner` snapshot without a host
  JavaScript interpreter, crash, or native semantic exit;
- all 3,292 authored ES5.1 Test262 files finish with zero failures and zero not
  run;
- the full hosted regression suite remains green and the demo/benchmark
  performance gates do not regress;
- ordinary standalone runs require neither generated checked-in files nor
  program-specific snapshot state.
