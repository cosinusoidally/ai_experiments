# Octane guest-VM bring-up and performance approach

## Objective

The external Octane 2.0 checkout is a demanding integration workload for the
ES5.1 guest VM. The immediate goal is to execute every suite correctly. Once
that is true, its stock score will help guide improvements to general-purpose
guest JavaScript performance.

The longer-term architectural goal remains a VM whose guest heap, bytecode
execution, language semantics, garbage collector, and native services are
independent of the bootstrap host. On MMVM, ordinary execution should stay in
the native interpreter and use the guest's native service/FFI boundary. The
Node backend must implement the same observable VM using the shared front and
middle ends, although Node necessarily remains the low-level execution host.

## External test tree

Octane is expected at `../../js_tests/octane`, relative to
`mmvm_v2_tests`. That external tree is read-only for this work. The checked-in
`octane_runner.js` loads the original files in place and contains the selection
and reporting logic needed by the guest VM. It must never copy, rewrite, or
patch an Octane source file.

The normal form for an individual stock run is:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe \
  guest_runner.js --vm-native octane_runner.js Richards
```

The same unmodified wrapper can run from a generic standalone image:

```sh
./artifacts/js_runner.exe artifacts/snap octane_runner.js Richards
```

The snapshot must have been generated from the current interpreter sources.
It contains the initialized VM and native interpreter, not an Octane program;
`octane_runner.js` and the selected external suite are read and compiled after
launch. `--quick` has the same correctness-only meaning on both paths.

Passing `all` selects every suite. With no suite argument, all suites are also
selected. `--quick` changes each loaded benchmark to one deterministic,
non-warmup iteration. This mode is only a bring-up and correctness diagnostic;
it does not produce or claim an Octane score. A suite counts as fully working
only after its original, stock timing and warmup configuration completes with
all of its own validation checks enabled.

## Correctness sequence

Suites are brought up individually in their original order. For each failure:

1. Reproduce the smallest relevant language-level behaviour without modifying
   the external suite.
2. Decide whether the failure is missing ES5.1 semantics, a VM correctness
   defect, exhausted guest resources, or unsupported host-facing behaviour.
3. Implement the general VM facility at its proper layer. Add coverage to an
   existing high-level language, embedding, heap, or compiler test when that
   protects a meaningful contract.
4. Run the complete Node-hosted and js_min-hosted guest test suites.
5. Recheck already-working Octane suites and the existing demo smoke tests
   before committing a stable milestone.

The original Octane assertions, checksums, and error paths remain authoritative.
Completing a script or printing a timing is not by itself a pass.

## Performance policy

No optimization may recognize an Octane suite, benchmark function, source
string, filename, constant, or call site. There will be no benchmark-specific
bytecode, intrinsic, native helper, precomputed answer, source rewrite, or
special allocation policy.

Profiling data is used to identify general costs such as:

- bytecode dispatch and operand decoding;
- guest property lookup, shapes, prototypes, and inline caches;
- calls, frames, closures, and lexical environments;
- numeric representation and integer/binary64 operations;
- arrays, strings, regular expressions, and typed-array-like storage;
- allocation rate, tracing, collection, and heap growth;
- semantic exits from the native interpreter;
- compilation, program registration, and startup work;
- native service and FFI transitions.

Improvements should make the underlying operation faster for arbitrary guest
programs and should normally be expressed in the kernel dialect, shared IR,
heap-record accessors, or reusable runtime data structures. Named record-field
accessors remain mandatory; raw offset arithmetic must not spread through the
interpreter. Native code must be produced through the JavaScript macro
assembler rather than embedded instruction blobs.

The shared front and middle ends remain the semantic authority for both
backends. Where a fast native implementation is introduced, the Node backend
gets the corresponding general implementation and equivalence coverage. Work
should progressively remove dependence on host objects and callbacks rather
than making a fast path that only functions because SpiderMonkey owns part of
the guest state.

## Measurements and regression gates

Before score optimization, record stock per-suite time and score plus native
interpreter profile data. Compare changes at the same host, snapshot mode,
suite selection, and build. Startup/compilation time and measured benchmark
time are reported separately.

An improvement is accepted only if:

- all previously passing guest language, buffer, heap, embedding, compiler,
  networking, and context tests still pass under Node and js_min;
- already-working Octane suites retain correctness;
- the existing demo command paths continue to compile and run correctly;
- representative interactive demos do not lose frame rate or stability; and
- Node-hosted guest performance is not needlessly regressed by an MMVM-native
  optimization.

Octane score work begins only after all suites complete correctly with stock
settings. Optimization commits should state the affected general mechanism,
the before/after measurements, and the regression checks performed.

## Bring-up status

### Complete standalone stock sweep, 2026-09-27

All 15 Octane 2.0 suites were run individually through the generic standalone
image on 2026-09-27 between approximately 10:51 and 11:23 BST. This is the
first complete stock sweep that records standalone scores rather than carrying
forward scores from the js_min-hosted guest path.

The measured revision and image were:

- repository commit: `5956d6957a875d0fcbe5c9609f17ea081fa08ddf`;
- snapshot size: 16,437,872 bytes, non-sparse;
- snapshot SHA-256:
  `c21fad71ac9743810d11bc74629607c25ed179936eb255bf2bd1ded5ebb6267d`;
- host: Linux 6.8.0-138-generic on a QEMU Virtual CPU version 2.5+; and
- limit: 900 wall-clock seconds per stock suite.

The stock command shape was:

```sh
/usr/bin/time -f \
  'wall=%e user=%U sys=%S maxrss_kib=%M exit=%x' \
  timeout --signal=TERM --kill-after=10s 900 \
  ./artifacts/js_runner.exe artifacts/snap octane_runner.js SUITE
```

The complete stock result is 4 passing/scored suites, 2 timeouts, 1 native
crash, and 8 standalone semantic exits. There is no valid aggregate Octane
score because all suites must finish successfully before the harness may
produce one.

| Suite | Current standalone stock status | Score | Wall time | Peak RSS |
| --- | --- | ---: | ---: | ---: |
| Richards | pass | 77.5 | 3.52 s | 39,552 KiB |
| DeltaBlue | pass | 83.9 | 4.92 s | 62,208 KiB |
| Crypto | pass | 125 | 33.53 s | 60,544 KiB |
| RayTrace | `SIGSEGV` after entering the benchmark | — | 3.02 s | 106,368 KiB |
| EarleyBoyer | timed out; no validation result | — | 900.00 s | 77,952 KiB |
| RegExp | timed out; no validation result | — | 900.03 s | 541,568 KiB |
| Splay | standalone semantic exit, status 70 | — | 0.50 s | 38,400 KiB |
| NavierStokes | pass | 236 | 11.83 s | 43,776 KiB |
| PdfJS | semantic exit during load/initialization, status 70 | — | 2.95 s | 42,880 KiB |
| Mandreel | semantic exit during load/initialization, status 70 | — | 8.36 s | 54,016 KiB |
| Gameboy | semantic exit during load/initialization, status 70 | — | 1.99 s | 47,488 KiB |
| CodeLoad | standalone semantic exit after benchmark entry, status 70 | — | 0.67 s | 41,472 KiB |
| Box2D | semantic exit during load/initialization, status 70 | — | 6.48 s | 99,584 KiB |
| zlib | standalone semantic exit after benchmark entry, status 70 | — | 12.00 s | 100,736 KiB |
| Typescript | semantic exit during load/initialization, status 70 | — | 8.12 s | 88,704 KiB |

Every non-scoring suite was subsequently rerun with one deterministic
iteration and no warmup by placing `--quick` after `octane_runner.js`. A quick
run deliberately produces no Octane score. It exists only to separate a stock
repetition/performance failure from failure of the benchmark's basic
correctness path.

- RayTrace passes quick correctness in 1.05 seconds at 70,016 KiB peak RSS.
  Its stock crash is therefore repetition, lifecycle, or collection related,
  rather than a failure of its first deterministic result.
- EarleyBoyer passes quick correctness in 6.51 seconds at 85,376 KiB peak RSS.
  Its current stock limitation is throughput.
- RegExp passes quick correctness in 114.84 seconds at 317,440 KiB peak RSS.
  Its stock run remains both too slow and memory intensive: it reaches the
  900-second ceiling and peaks at approximately 529 MiB.
- Splay, PdfJS, Mandreel, Gameboy, CodeLoad, Box2D, zlib, and Typescript all
  reproduce standalone status 70 in quick mode. They are not current
  standalone correctness passes.

The `--vm-profile` standalone option also returned status 70 before loading
each diagnostic program in this image, so it could not identify the operation
behind the semantic exits. The statuses above consequently do not claim a
more specific cause than the output establishes.

This yields a secondary quick-correctness summary of 7/15 passing: the four
stock-scored suites plus RayTrace, EarleyBoyer, and RegExp. Quick correctness
does not promote the latter three to stock passes and is never used as an
Octane score.

### Earlier bring-up history

Standalone-snapshot validation is tracked independently from the older
js_min-hosted baselines below. At the 2026-09-25 checkpoint, Richards,
DeltaBlue, Crypto, RayTrace, EarleyBoyer, and NavierStokes passed quick
correctness through `js_runner.exe`. zlib compiled its wrapper and 185 KiB
generated-data source, then exposed a native semantic exit after its benchmark
began. This distinction prevents a host-assisted pass from being reported as
self-hosted execution.

Richards standalone bring-up added general native facilities for
`Array.prototype.indexOf`, `Math.log`, `Number.prototype.toPrecision`, Date
construction, and Date-to-number arithmetic. The generic source runner now
instantiates top-level declarations before adopted bytecode begins, matching
ordinary script entry. Platform services are an explicit compiled-interpreter
parameter; the standalone bootstrap and js_min entry use the same ABI.
Subsequent bring-up added guest-native ES5 property definition, number
formatting, random numbers, string-to-number coercion, primitive receiver
boxing, boxed-string methods, object construction, and `Array.prototype.splice`.
The splice implementation also removed the last host dependency encountered by
the self-hosted front end while compiling EarleyBoyer.

The next standalone bring-up stage moved the initialization operations used by
zlib into the same compiled interpreter: Boolean conversion, `Date.now`, array
reversal, URI-component encoding, Annex B unescaping, typed-array bulk set,
and ArrayBuffer/typed-array construction. Typed views are not host objects:
the constructor allocates a guest backing record, a guest ArrayBuffer view,
and a guest typed view, and obtains their prototypes from rooted, named runtime
support slots. Length, ordinary-array-copy, and shared-ArrayBuffer forms are
covered by the standalone integration path. In a fresh 15-second execution
profile after initialization, zlib passed one million interpreted bytecodes
without typed-array constructor or set callbacks. It has not yet been promoted
to a standalone quick-correctness pass; remaining exits are being handled as
general VM facilities.

ES5 bracket indexing on strings is also handled directly by the compiled
interpreter. Latin-1 results reuse the rooted one-character table, while other
UTF-16 code units allocate a one-character guest string. This removed zlib's
three numeric string-property exits; a repeat initialization profile fell from
23 semantic exits to 20 without changing the external benchmark source.

The first standalone zlib front-end baseline took 151.8 seconds and peaked at
540.8 MiB RSS. The source contains one large generated string split by regular
backslash line continuations. Once the tokenizer encountered the first escape,
its slow path appended every subsequent ordinary character to an immutable
prefix, making decoding quadratic. The general string scanner now advances
over ordinary runs directly, records decoded fragments, and combines them in
a balanced reduction. Compiling the same unchanged 185 KiB file through the
self-hosted front end now takes 19.2 seconds and peaks at 136.4 MiB, including
native-interpreter compilation and front-end module loading. No parsed result
or source-specific cache is involved.

The faster path exposed a collector stability bug during the first full zlib
iteration. A host-triggered native collection rooted the string-support vector
explicitly but relied on structural discovery for the engine state and its
platform-service child. The service record was reclaimed and reused as an
ordinary object; `Number.prototype.toFixed` later read `0x1` from the former
`snprintf` slot. Both authoritative records are now explicit roots. The
unchanged quick-correctness run completes with the original checksum in 75.2
seconds at 305.5 MiB peak RSS.

The following baselines include native-interpreter compilation and process
startup in the wall-clock time. They are not directly comparable with the
score's internal benchmark interval.

| Suite | Stock correctness | Score | Total wall time | Notes |
| --- | --- | ---: | ---: | --- |
| Richards | passing | 76.4 | 15.36 s | Native loose equality reduced a quick run to about 40 semantic exits. |
| DeltaBlue | passing | 116 | 15.45 s | Native `Function.call`, `Array.pop`, and `Array` construction reduced a quick run from 2,912 semantic exits to 40. |
| Crypto | passing | 129 | 48.02 s | Required general compound `<<=`, `>>=`, and `>>>=` parsing and bytecode lowering. |
| RayTrace | passing | 104 | 37.66 s | Passed with the existing ES5.1 and native-interpreter facilities. |
| EarleyBoyer | passing | 138 | 119.65 s | Added `in`, native `instanceof`, `try`/`finally`, script-level `this`, and extensible guest string prototypes. |
| RegExp | bring-up passing on Node; native stock baseline pending | — | — | Added regexp literals beginning with `=`, `String.match`, regexp `split`, cached host patterns, native substring/fromCharCode, and corrected the single-character replace fast path so semantic escapes cannot be treated as literal characters. Native execution remains dominated by general RegExp semantic transitions. |
| Splay | quick correctness passing; stock baseline pending | — | 20.65 s quick | Added `Date.now`. The old 256 MiB maximum could not contain the live tree and caused futile repeated collections. Exact-capacity Array literals subsequently reduced the guest bump from 269,996,280 to 183,119,272 bytes. |
| NavierStokes | passing | 283 | 26.05 s | Added ES5.1 non-strict receiver normalization for bare calls and `Function.call`/`apply` with nullish receivers. |
| PdfJS | bring-up in progress | — | — | Object-literal accessors, heap-backed ArrayBuffer/typed arrays, `bind`, `forEach`, `splice`, `trim`, and JSON are implemented. The renderer now reaches asynchronous font loading; its stock checksum is not yet passing. |
| zlib | passing | 257 | 600.14 s | Original ten-iteration validation, using an explicitly selected unchecked native snapshot. Quick correctness passes in 141.70 s. |

The times above were measured on the current development machine with no
snapshot. They are working baselines, not claimed stable performance numbers
for other systems.

The zlib row is the stated exception to the no-snapshot measurements. Its exact
stock invocation was:

```sh
LD_LIBRARY_PATH=../../firefox-1.0.8/lib \
  ../../mmvm_v2/artifacts/js_min.exe guest_runner.js \
  --with-snapshot artifacts/zlib-native.snapshot \
  --skip-snapshot-hash octane_runner.js zlib
```

The snapshot affects native-interpreter startup only; Zlib's dynamically
evaluated 185 KiB generated program is still parsed and compiled on every run.
The snapshot file is an ignored temporary artifact and is not part of the
repository.

The self-hosted zlib path now has a native indirect-eval continuation. Its
generated source enters the guest tokenizer, parser, verifier, and bytecode
adopter through a retained guest function, and the resulting executable is
called by the normal guest frame engine. This is a general implementation of
indirect global eval rather than a zlib source hook. Direct eval remains a
distinct lexical operation and is deliberately not redirected through this
global-code path.

Zlib bring-up added general ES5 facilities rather than source accommodations:
indirect global eval, labelled statements and labelled abrupt control flow,
the global `NaN`, `Infinity`, and `Boolean` bindings, Annex B `escape` and
`unescape`, signed 8- and 16-bit typed arrays, and the Node-compatible POSIX
`path` subset. A 128 MiB ArrayBuffer allocation exposed that typed-array
prototype tables were missing from the collector's strong root set; both
collector backends now retain those runtime-owned prototypes explicitly.

The dominant initial execution bottleneck was also general. Generated code
uses non-short-circuit `&` and `|` to combine boolean comparisons. The native
interpreter previously accepted only numeric-tagged operands for bitwise
operations, causing repeated semantic exits even though ES conversion is
simple. Native `ToInt32` handling now covers booleans, null, and undefined for
all bitwise operations, while strings and objects retain the semantic path.

PdfJS exposed a separate Node-host memory problem in the low-level heap
emulator. Storing each written guest byte as a property on one host object
exhausted Node's heap during the renderer. `host_memory.js` now uses lazily
allocated 64 KiB byte pages. This remains a peek/poke-style linear-memory
backend: guest objects and typed-array elements are not represented by host
objects, and the MMVM `calloc` backing is unchanged.

For memory context, the initial corrected quick Splay run peaked at 442,860
KiB RSS in the guest VM. Emitting an initial-capacity operand for `MAKE_ARRAY`
reduced that to 358,156 KiB by preventing literal construction from allocating
and abandoning multiple successively larger element vectors. Node v24.14.1
running the same unmodified suite and quick wrapper peaks at 134,792 KiB RSS
and takes 0.43 s. The guest's current representation stores
each ordinary property in a separate 48-byte linked heap record and each value
cell in 16 bytes. Splay creates roughly half a million recursively nested
payload objects, so compact per-object property storage and denser value cells
are high-value general representation work, independent of Octane.

The measured preallocation heap delta is 86,877,008 bytes: value-vector records
fell from 776,068 records / 134,766,064 bytes to 258,951 records / 47,888,968
bytes. The bytecode verifier bounds the capacity operand, and both the native
and JavaScript interpreter backends implement the same instruction. Dynamic
arrays retain their ordinary growth behavior.

Native heap-pressure profiling reports bump, current logical limit, reserved
maximum, next pressure point, growth count, and collection count. Once a full
collection leaves a large live graph above the normal three-quarter pressure
mark, the next pressure point is placed at least 1 MiB above the surviving
bump. Actual allocation failure still forces collection; an unchanged live set
does not cause collection again at every semantic boundary.

The RegExp workload also exposed a cross-context collector invariant: a yield
must publish the youngest active frame separately for each owning `JSContext`.
Publishing a loaded script's callee under the entry context could leave a freed
frame reachable after return. Frame construction is now rooted before any
allocation-capable value conversion, frame release clears its owning context,
and yielded executions publish active roots per context.

## 2026-09-27: standalone pressure and compact RegExp instructions

`octane_runner.js --setup-only <suite>` loads the ordinary external suite,
invokes every selected benchmark's stock `Setup`, reports its elapsed time,
and then invokes `TearDown`. It does not replace benchmark data or correctness
logic. This isolates construction and warm-up costs without editing anything
under `../../js_tests/`.

Standalone snapshots previously installed the full 512 MiB reserved maximum
as the allocator's active limit. Consequently, allocation-heavy code did not
ask the native collector to run until it had touched essentially the complete
reservation. Engine state now records the maximum separately from the active
pressure limit. A standalone image starts at the same ordinary pressure point
as hosted execution, reuses swept free records first, and increases headroom
after a collection in proportion to reclaimed bytes. In a stopped RegExp
setup diagnostic this changed resident memory from approximately 541 MiB to
66--82 MiB. The setup was still far too slow, so this is a memory/collector
correction rather than a claim that RegExp is complete.

The following general matcher costs were then removed:

- an unquantified atom no longer goes through four counted-repeat instructions
  or consumes two repeat-state slots;
- the matcher loop no longer allocates `push` and `fail` closures for every
  candidate position; and
- compiled matcher instructions are parallel opcode/operand arrays rather than
  per-dispatch objects. Character-class and lookahead objects remain only for
  operations that require structured data.

A fixed 30-second Node kernel profile still reaches the same 11,001,861
bytecode budget, but native-kernel time fell from about 31.5 seconds before
these changes to about 29.9 seconds. Constant-property operations in that
slice fell by roughly 600,000. The remaining runtime is dominated by general
guest bytecode/property/array work; it must be improved without recognizing
Octane sources or delegating regular expressions to the host.

## 2026-09-27: typed RegExp machine storage

The setup-only runner now calls `BenchmarkSuite.ResetRNG()` before entering
the selected setup functions, as the stock Octane harness does. Without that
step, both stock Node RegExp and the guest matcher correctly reject the final
checksum because the generated input variants are nondeterministic. With the
seed restored, the benchmark's own checksum is authoritative in this mode.

Matcher start metadata now retains the longest common literal prefix across
alternatives, not merely a common first character. The search remains
conservative: only consecutive, exactly-once literal atoms participate, and
case-insensitive patterns retain their explicit character scan.

Compiled instructions use one fixed-width `Int32Array`. Capture state and the
backtracking PC, input-position, and saved-state stacks use reusable typed
arrays that double only when their previous high-water mark is exceeded.
These are guest heap buffer-backing records; neither backend stores a host
array as guest state. Structured character classes and nested lookahead
programs remain in a side table.

On the deterministic stock setup checksum:

- hosted native execution changed from 100.5 seconds total / 86.3 seconds in
  setup to 86.2 / 72.3 seconds;
- standalone execution changed from 108.1 seconds total / 106.1 seconds in
  setup to 76.5 / 74.6 seconds; and
- standalone peak RSS changed from approximately 211 MiB to 194 MiB.

A profiling run still records approximately 2.51 billion guest bytecodes.
Typed storage makes those operations cheaper and avoids many heap records, but
the next major improvement must reduce matcher control-flow work itself, most
likely by moving the low-level executor into the kernel dialect while keeping
parsing and compilation guest-owned.

## 2026-09-27: matcher invariants and reclaimed-region growth

The matcher now reads flags, input length, state-slot count, and current stack
capacity once per invocation. These values do not change during its inner
instruction loop. Hoisting them reduced one hosted deterministic setup from
72.3 to 65.9 seconds without changing its checksum.

That run also exposed an allocator policy error: the hosted collector doubled
the logical heap whenever its untouched tail was exhausted, even when the
sweep had produced hundreds of MiB of reusable records and a single very large
contiguous arena. The speed measurement consequently touched nearly the full
heap reservation and peaked at 602 MiB RSS despite a 6--7 MiB live set.

An exhausted tail now causes fragmentation growth only when the largest
reusable block is less than one sixteenth of total reusable bytes. Persistent
live-set pressure and a genuine inability to supply the minimum native arena
remain independent growth reasons. The next measured run peaked at 257 MiB and
took 91.7 seconds total, still better than the original 100.5-second hosted
baseline but slower than consuming fresh tail pages. This is the intended
trade: further speed must come from less matcher work and better native region
execution, not unbounded heap expansion.

## 2026-09-27: literal runs and simple quantifiers

The guest regex compiler now coalesces consecutive exactly-once literal atoms
into one instruction. It also lowers quantified literals, dot, classes, and
class escapes to a simple-quantifier instruction. The latter scans the atom
once, then records possible continuation positions in the same LIFO order as
the generic greedy/lazy backtracking machine. Groups, captures, lookahead, and
backreferences continue through the general instruction sequence.

Simple quantifier alternatives all begin with the same capture state. Stack
entries therefore carry a typed-array snapshot index: the quantifier copies
state once and all of its alternatives reference that immutable slot. Normal
branches continue to own one snapshot each. This preserves later restoration
when intervening instructions mutate captures.

With stock deterministic input and the conservative reclaimed-region policy,
literal runs reduced hosted total time from 91.7 to 89.9 seconds. Simple
quantifiers reduced it to 85.1 seconds, and shared state snapshots to 82.6
seconds. Setup itself moved from 78.2 to 67.8 seconds. Peak RSS remained around
255--261 MiB and the Octane checksum passed after each stage.
