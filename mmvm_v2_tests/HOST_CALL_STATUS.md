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

- complete the guest-owned Test262 driver on top of the existing standalone
  `require`, `load`, and synchronous filesystem implementation;
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
- Passed: zlib (81.96 s, 257,664 KiB). This includes self-hosted indirect
  eval, ordinary guest `require("fs")`/`require("path")`, a 128 MiB
  ArrayBuffer, automatic heap growth/collection, budget resumption, and
  native global teardown.
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
3. Complete ordinary object constant-property lookup for the remaining object
   layouts exercised by EarleyBoyer and the other failing suites. Zlib's
   missing-global ReferenceError path and indirect-eval global realm are now
   native and passing.
4. Profile and fix Mandreel's large startup/execution cost through general
   parser, compiler, heap, GC, and dispatch improvements.
5. Implement the correct regex subset needed by dependent programs; defer a
   specialized high-performance regex engine and the standalone RegExp score.
6. After correctness, run stock (non-quick) Octane via `js_runner`, record
   scores, and optimize only general VM mechanisms.

### 2026-09-29: standalone zlib closure

- Before: standalone zlib stopped on missing-global `Module` resolution, then
  on `require` resolved in the self-hosted compiler module's realm, and later
  exhausted the standalone bootstrap's single instruction slice.
- After: Octane quick correctness passes through the generic `js_runner`
  snapshot in 81.96 seconds at 257,664 KiB peak RSS, with exit status 0.
- General VM work: native ReferenceError construction/unwinding for missing
  globals; an explicit indirect-eval compiler result carrying global
  declaration metadata; rebinding the actual compiled callable to the
  caller's JSContext; standalone budget-yield resumption from the engine's
  named current-frame field; and native `DELETE_NAME` for statically resolved
  lexical/global code.
- Deliberately not added: no intrinsic dispatch on module-name strings, no
  zlib source hook, no cached zlib parse, and no program state in the generic
  snapshot.

### 2026-10-04: standalone HTTP runtime repair

The old `node_web.js` first-request blocker described above is now closed.
This is a runtime repair; `node_web.js`, the demos, test programs and C sources
were not changed.

- URI decoding executes in the native kernel, including UTF-8 validation,
  surrogate-pair output and `decodeURI`'s reserved-escape preservation.
  Malformed string input constructs and unwinds a guest URIError, rather than
  returning to the host for the error path. Non-string coercion and unhandled
  exceptions still have semantic-boundary limitations; this is not a claim
  that every form of URI conversion is standalone-complete.
- Uppercase and lowercase share the existing native ASCII case-conversion
  algorithm. Unicode case conversion remains a separate outstanding feature.
- `Buffer.isBuffer` inspects the native view kind. The HTTP compatibility
  runtime reads heap-backed response Buffers as bytes, rather than attempting
  to stringify them or assuming the array fallback's private `_nodeBytes`.
- `Buffer.byteLength` now runs guest JavaScript, not a Node/js_min callback.
  Its UTF-8 count handles surrogate pairs and lone-surrogate replacement;
  single-byte and UTF-16 encodings are also handled. This helper is not a
  claim of complete support for every Node encoding/API.
- All seven standard Error constructors share a native construction helper
  and one authoritative constructor-name/ID mapping. This supports filesystem
  failures without changing the caller's error handling. Other Error API
  details, including standalone object-to-string conversion, remain open.
- Array sorting uses an iterative guest merge sort, including comparator
  calls, undefined entries and holes; no host array sort is involved in the
  Node-compatible guest environment. This is general language functionality,
  not a directory-listing-specific hook.
- Self-hosted program adoption accepts exact int32-valued doubles as well as
  int32 cells. Negative global catch descriptors previously failed because
  their numeric representation was mistaken for a language/type violation.
- The standalone reporting boundary uses an exception's name/message when
  there is no stack, so another object-to-string failure does not mask it.

Verification at this checkpoint:

- Existing dual-host suite: all 12 guest programs and 269 assertions pass
  under each of Node and js_min, together with the existing embedding, heap,
  GC, context, compiler and runner checks.
- Fresh generic standalone image: text GET, binary GET, HEAD, malformed URL
  (400), missing file (404) and generated directory listing (200) pass through
  unchanged `node_web.js`. Text and executable bodies compare byte-for-byte
  with their source files. These calls use guest-owned libc filesystem/socket
  services; there is no JavaScript host in `js_runner`.
- Writing another snapshot through `js_runner` and `guest_runner.js` produces
  a byte-identical image.
- An additional direct standalone audit of the 12 guest programs passes 7
  and exposes 5 existing incomplete paths: Function.bind, isFinite and later
  standard-library coverage, the test embedder's `guestCollect` service,
  typed-array property coverage (first failure: byteLength), and Buffer.fill
  and later Buffer operations. The pre-refactor snapshot was checked against
  the same five programs and also fails them. Hosted passes are not being
  misreported as standalone passes. The Buffer audit now reaches fill whereas
  the baseline stopped earlier at Buffer.isBuffer.

Generated logs and snapshots remain in ignored `artifacts/`. Long-running
demo observations are recorded separately; neither HTTP nor unit-test success
alone proves demo GC stability or frame-rate parity.

### 2026-10-04: final regression and calendar follow-up

- The HTTP audit exposed an existing native DayFromYear error: the 400-year
  leap-day term used the century-exclusion base (1901) rather than its own
  ES5.1 base (1601). System timestamps consequently appeared one day late in
  guest logs. The corrected kernel agrees with UTC calendar reference values
  for 1970, 2000, 2001, 2100, 1900 and year 1, including weekdays.
- The URI percent constant is now one genuine module-level lexical binding,
  supplied through `constantBindings`, rather than duplicated uppercase local
  declarations depending on the legacy compiler convention.
- Comparing the native-code sections of the HTTP-repair image and the final
  image gives equal lengths (388,188 bytes) and exactly two differing bytes:
  the immediate operand changing 1901 to 1601. The constant cleanup changes
  no generated instructions. The long demo observations therefore exercised
  the same rendering/GC engine; the follow-up does not introduce an unmeasured
  interpreter rewrite.
- The dual-host suite was rerun after the follow-up: all 12 programs / 269
  assertions pass on each host, along with the existing ancillary checks.
- Standalone quick correctness: Splay, SplayLatency, NavierStokes and zlib all
  pass. The combined run took 91.02 seconds with 318,464 KiB peak RSS, exit 0.
  This is a correctness checkpoint, not a full Octane score or a directly
  comparable timing for the earlier zlib-only run.
- The final generic image serves a default index, generated subdirectory
  listing (200), slash redirect (301), malformed URL (400), missing file
  (404), binary GET and binary HEAD through unchanged `node_web.js`. The index
  and binary bodies compare byte-for-byte with their files. Log dates now
  agree with the system calendar. Regenerated snapshots remain bit-identical.

The five pre-existing standalone test gaps listed above remain open. All eight
demos completed the finite interactive regression runs recorded in
GC_STABILITY.md, without a crash or native error. Poor performance of demos
1–7 remains open; these runs must not be described as completing the overall
standalone or performance work.

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
